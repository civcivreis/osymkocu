alter table public.memory_lesson_scenes
  add column if not exists overlay_cards jsonb not null default '[]'::jsonb;

alter table public.memory_lesson_questions
  add column if not exists checkpoint_intro text,
  add column if not exists correct_feedback text,
  add column if not exists wrong_feedback text,
  add column if not exists retry_question_text text;

alter table public.lesson_timeline_events drop constraint if exists lesson_timeline_events_type_check;
alter table public.lesson_timeline_events
  add constraint lesson_timeline_events_type_check check (event_type in (
    'scene_change', 'card_show', 'card_hide', 'checkpoint', 'checkpoint_intro',
    'coach_note', 'highlight', 'pause', 'resume', 'lesson_complete'
  ));

create or replace function public.short_memory_anchor(p_text text, p_max int default 8)
returns text
language plpgsql
immutable
as $$
declare
  v_words text[];
begin
  v_words := regexp_split_to_array(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), '\s+');
  if coalesce(array_length(v_words, 1), 0) = 0 then return ''; end if;
  if array_length(v_words, 1) <= p_max then return array_to_string(v_words, ' '); end if;
  return array_to_string(v_words[1:p_max], ' ');
end;
$$;

create or replace function public.rebuild_lesson_pedagogy_timeline(p_lesson uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_scene record;
  v_q record;
  v_card jsonb;
  v_span int;
  v_start int;
  v_end int;
  v_sort int := 0;
  v_intros text[] := array[
    'Tamam, şimdi bunu sana soracağım.',
    'Bunu kaptın mı hemen bakalım.',
    'Şimdi aynı mantığı sen uygula.',
    'Buraya kadar tamam. Bir tane sen çöz.',
    'Şimdi sıra sende.'
  ];
  v_intro text;
  v_idx int := 0;
begin
  delete from public.lesson_timeline_events where lesson_id = p_lesson;

  for v_scene in
    select * from public.memory_lesson_scenes where lesson_id = p_lesson order by scene_order
  loop
    v_span := greatest(v_scene.end_ms - v_scene.start_ms, 1);
    if jsonb_typeof(v_scene.overlay_cards) = 'array' and jsonb_array_length(v_scene.overlay_cards) > 0 then
      for v_card in select value from jsonb_array_elements(v_scene.overlay_cards)
      loop
        v_start := coalesce((v_card->>'start_ms')::int, v_scene.start_ms + (v_span * 12) / 100);
        v_end := coalesce((v_card->>'end_ms')::int, v_scene.end_ms - (v_span * 14) / 100);
        v_sort := v_sort + 1;
        insert into public.lesson_timeline_events (
          lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, sort_order
        ) values (
          p_lesson, 'card_show', coalesce(v_card->>'card_type', 'HAP BİLGİ'), v_start, false,
          jsonb_build_object(
            'title', coalesce(v_card->>'card_type', 'HAP BİLGİ'),
            'body', public.short_memory_anchor(v_card->>'short_text', 8),
            'semantic_key', v_card->>'semantic_key',
            'narration_segment_id', v_card->>'narration_segment_id',
            'scene_id', v_scene.id,
            'hide_at_ms', v_end
          ),
          v_sort
        );
      end loop;
    else
      v_start := v_scene.start_ms + (v_span * 12) / 100;
      v_end := v_scene.end_ms - (v_span * 14) / 100;
      v_sort := v_sort + 1;
      insert into public.lesson_timeline_events (
        lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, sort_order
      ) values (
        p_lesson, 'card_show', 'HAP BİLGİ', v_start, false,
        jsonb_build_object(
          'title', coalesce(nullif(v_scene.visual_anchor, ''), 'HAP BİLGİ'),
          'body', public.short_memory_anchor(coalesce(v_scene.memory_target, v_scene.caption), 8),
          'semantic_key', 'scene-' || v_scene.scene_order,
          'narration_segment_id', 'scene-' || v_scene.scene_order,
          'scene_id', v_scene.id,
          'hide_at_ms', v_end
        ),
        v_sort
      );
    end if;
  end loop;

  for v_q in
    select q.*, s.end_ms as scene_end
    from public.memory_lesson_questions q
    left join lateral (
      select sc.end_ms from public.memory_lesson_scenes sc
      where sc.lesson_id = q.lesson_id
        and (sc.id = q.related_scene_id or sc.scene_order = least(
          (select max(scene_order) from public.memory_lesson_scenes where lesson_id = q.lesson_id),
          greatest(1, q.question_order * 2)
        ))
      order by case when sc.id = q.related_scene_id then 0 else 1 end
      limit 1
    ) s on true
    where q.lesson_id = p_lesson and q.question_type = 'checkpoint'
    order by q.question_order
  loop
    v_idx := v_idx + 1;
    v_intro := coalesce(nullif(v_q.checkpoint_intro, ''), v_intros[1 + ((v_idx - 1) % array_length(v_intros, 1))]);
    v_sort := v_sort + 1;
    insert into public.lesson_timeline_events (
      lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, sort_order, related_question_id
    ) values (
      p_lesson, 'checkpoint_intro', 'CHECKPOINT_INTRO',
      greatest(coalesce(v_q.scene_end, 0) - 80, 0), false,
      jsonb_build_object('title', 'KOÇ', 'body', v_intro, 'intro_in_audio', false),
      v_sort, v_q.id
    );
    v_sort := v_sort + 1;
    insert into public.lesson_timeline_events (
      lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, sort_order, related_question_id
    ) values (
      p_lesson, 'checkpoint', 'QUESTION',
      coalesce(v_q.scene_end, 0) + 450, true,
      jsonb_build_object(
        'title', 'KONTROL',
        'question_id', v_q.id,
        'intro', v_intro,
        'correct_feedback', coalesce(v_q.correct_feedback, 'Aynen, bu.'),
        'wrong_feedback', coalesce(v_q.wrong_feedback, v_q.explanation),
        'retry_question_text', coalesce(v_q.retry_question_text, v_q.question_text)
      ),
      v_sort, v_q.id
    );
  end loop;

  insert into public.lesson_timeline_events (lesson_id, event_type, appear_at_ms, pause_audio, payload, sort_order)
  select p_lesson, 'lesson_complete', greatest(coalesce(duration_sec, 1) * 1000 - 200, 1000), false, '{}'::jsonb, 999
  from public.memory_lessons where id = p_lesson;

  select count(*) into v_count from public.lesson_timeline_events where lesson_id = p_lesson;
  return v_count;
end;
$$;

grant execute on function public.rebuild_lesson_pedagogy_timeline(uuid) to authenticated;
grant execute on function public.short_memory_anchor(text, int) to authenticated;

create or replace function public.ensure_lesson_timeline(p_lesson uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.rebuild_lesson_pedagogy_timeline(p_lesson);
end;
$$;

-- Repair Giriş Cümlesi: one short card per scene + varied intros.
update public.memory_lesson_scenes s
set overlay_cards = jsonb_build_array(
  jsonb_build_object(
    'card_type', case s.scene_order % 4
      when 1 then 'HAP BİLGİ'
      when 2 then 'HIZLI TEKNİK'
      when 3 then 'TUZAK'
      else 'HATIRLA'
    end,
    'short_text', public.short_memory_anchor(coalesce(nullif(s.visual_anchor, ''), s.memory_target, s.caption), 8),
    'semantic_key', 'giris-' || s.scene_order,
    'narration_segment_id', 'giris-seg-' || s.scene_order,
    'start_ms', s.start_ms + greatest(400, (s.end_ms - s.start_ms) * 12 / 100),
    'end_ms', s.end_ms - greatest(900, (s.end_ms - s.start_ms) * 14 / 100)
  )
)
where s.lesson_id in (
  select id from public.memory_lessons
  where title ilike '%giriş cümlesi%' or topic ilike '%giriş cümlesi%'
);

update public.memory_lesson_questions q
set
  checkpoint_intro = (array[
    'Tamam, şimdi bunu sana soracağım.',
    'Bunu kaptın mı hemen bakalım.',
    'Şimdi aynı mantığı sen uygula.',
    'Buraya kadar tamam. Bir tane sen çöz.',
    'Şimdi sıra sende.'
  ])[1 + ((q.question_order - 1) % 5)],
  correct_feedback = (array['Aynen, bu.', 'Tamamdır, devam.', 'Süper, oturdu.', 'Doğru. Devam edelim.'])[1 + ((q.question_order - 1) % 4)],
  wrong_feedback = coalesce(nullif(q.wrong_feedback, ''), q.explanation),
  retry_question_text = coalesce(nullif(q.retry_question_text, ''), q.question_text)
where q.question_type = 'checkpoint'
  and q.lesson_id in (
    select id from public.memory_lessons
    where title ilike '%giriş cümlesi%' or topic ilike '%giriş cümlesi%'
  );

do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.memory_lessons
    where title ilike '%giriş cümlesi%' or topic ilike '%giriş cümlesi%'
  loop
    perform public.rebuild_lesson_pedagogy_timeline(v_id);
  end loop;
end;
$$;
