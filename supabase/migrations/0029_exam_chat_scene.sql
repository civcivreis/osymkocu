-- Conversation scene + planner + validation for exam group bots. Paste after 0028.
-- Stops independent one-liners ("17 gibi bende") and makes turns follow a shared thread.

alter table public.exam_chat_room_state
  add column if not exists scene_topic text,
  add column if not exists subtopic text,
  add column if not exists mood text not null default 'casual',
  add column if not exists thread_summary text,
  add column if not exists unresolved_question text,
  add column if not exists last_meaningful_id uuid,
  add column if not exists topic_age int not null default 0,
  add column if not exists last_relation text;

alter table public.exam_bot_memory
  add column if not exists question_number int not null default 12,
  add column if not exists last_result text,
  add column if not exists last_meaning text;

update public.exam_chat_room_state
set scene_topic = coalesce(scene_topic, current_thread),
    mood = coalesce(nullif(mood, ''), 'casual')
where true;

delete from public.exam_chat_line_bank
where body ~* 'gibi bende'
   or public.exam_chat_norm(body) in (
     public.exam_chat_norm('bende de öyle'),
     public.exam_chat_norm('aynen ya'),
     public.exam_chat_norm('doğru, bende de tutuyor'),
     public.exam_chat_norm('katılıyorum buna'),
     public.exam_chat_norm('evet bende de öyle oldu'),
     public.exam_chat_norm('bende tersi biraz'),
     public.exam_chat_norm('ben öyle yapmıyorum'),
     public.exam_chat_norm('emin değilim, bende tutmuyor'),
     public.exam_chat_norm('yok bende öyle gitmiyor'),
     public.exam_chat_norm('hmm tamam'),
     public.exam_chat_norm('iyiymiş'),
     public.exam_chat_norm('ha öyle mi'),
     public.exam_chat_norm('anladım'),
     public.exam_chat_norm('olay bu ya'),
     public.exam_chat_norm('evet ondan bahsediyorum'),
     public.exam_chat_norm('kısa cevap: bende tempo tutunca düzeliyor'),
     public.exam_chat_norm('bende de aynı yerdeyim'),
     public.exam_chat_norm('{dk} gibi bende'),
     public.exam_chat_norm('ben konuyu değiştim biraz'),
     public.exam_chat_norm('aynı tempoyla gidiyorum'),
     public.exam_chat_norm('süre tutunca bende de oturdu')
   );

insert into public.exam_chat_line_bank (exam, intent, thread_key, persona, body) values
('*','ask_followup','*','*','hangi dersten bahsediyorsun'),
('*','ask_followup','*','*','kaç yanlışın çıktı sende'),
('*','ask_followup','*','ayse','hangi testti o'),
('*','ask_followup','*','kaan','süre nasıl gitti sende'),
('*','ask_followup','deneme','*','deneme hangi derstendi'),
('*','ask_followup','cografya','ayse','haritada mı takıldın'),
('*','ask_followup','problem_hiz','*','10 probleme kaç dk veriyorsun'),
('*','ask_followup','paragraf','*','paragrafta tempo tutuyor musun'),
('*','answer','*','*','ben de {sub} çalışıyorum şu an'),
('*','answer','*','mert','ben süre tutunca {sub} biraz düzeldi'),
('*','answer','*','kaan','ben {qnum}. sorudayım, {sub} yavaş gidiyor'),
('*','answer','problem_hiz','mert','ben 10 probleme {dk} dk veriyorum artık'),
('*','answer','deneme','*','ben denemede {sub} kısmını yeni tarıyorum'),
('*','answer','cografya','ayse','ben de coğrafyadayım, haritada takıldım'),
('*','answer','paragraf','can','ben paragraf geçtim, problem durdu bende'),
('*','agree','*','*','bende de süre aşağı yukarı aynı'),
('*','agree','*','*','evet {sub} tarafı bende de ağır geldi'),
('*','agree','cografya','kaan','harita kısmı bende de kötü ya'),
('*','agree','problem_hiz','*','süre yetiştirmesi bende de zor'),
('*','agree','deneme','selin','deneme sonucu bende de planı bozmadı'),
('*','disagree','*','*','bende {sub} daha rahat gidiyor aslında'),
('*','disagree','*','kaan','yok bende {sub} o tempoda gitmiyor'),
('*','share_progress','*','selin','bugün {result} gitti, plan duruyor'),
('*','share_progress','*','mert','ben {sub} {done} soru kestim, idare eder'),
('*','share_progress','*','kaan','ben {qnum}. sorudayım az kaldı'),
('*','share_progress','*','*','{sub} {done}/{goal} oldum bugün'),
('*','share_progress','deneme','selin','denemede {result} yaptım'),
('*','share_progress','cografya','ayse','coğrafyada {done} soru çözdüm'),
('*','continue_previous','*','*','ben de aynı {sub} yerinden devam ediyorum'),
('*','continue_previous','*','mert','ben bitirip geçicem artık {sub} kalsın'),
('*','continue_previous','cografya','*','haritayı bırakıp iklim sorularına geçiyorum'),
('*','joke','*','can','ben {sub} saldım başka sete geçtim'),
('*','joke','cografya','can','ben coğrafyayı saldım paragraf geçtim'),
('*','joke','problem_hiz','can','problemi kapattım, paragraf daha kolay geldi'),
('*','encourage','*','selin','planı bozmayın, {sub} kısa tutun yeter'),
('*','encourage','*','ayse','devam edin bence, {sub} tempo gelir'),
('*','invite_to_room','*','selin','10 dk sonra oda açsam gelen var mı'),
('*','invite_to_room','*','ayse','akşam {sub} odası açan var mı'),
('*','invite_to_room','oda','*','bana da uyar, gelirim'),
('*','answer','oda','mert','gelirim, kısa bakacağım'),
('*','answer','oda','ayse','gelirim'),
('*','answer','oda','kaan','bana da uyar'),
('*','change_topic','paragraf','can','bu arada ben paragraf tarafına geçtim'),
('*','change_topic','tarih','mert','bu arada tarihe döndüm biraz'),
('*','change_topic','cografya','ayse','bu arada coğrafya odası açan var mı'),
('*','change_topic','fen','*','bu arada kısa fen tekrarına geçtim'),
('tyt','ask_followup','deneme','ayse','iyiymiş, hangi dersten'),
('tyt','answer','deneme','selin','coğrafya, deneme sonucu idare eder'),
('tyt','continue_previous','deneme','mert','ben de coğrafyadayım, haritada takıldım'),
('tyt','agree','deneme','kaan','harita kısmı bende de kötü ya'),
('ayt','ask_followup','mat','*','türev mi integral mi bakıyorsun'),
('ayt','answer','mat','kaan','türevde takıldım, yavaş gidiyorum'),
('ayt','share_progress','mat','mert','ayt mat {done} soru oldu bugün'),
('kpss','ask_followup','tarih','*','kronoloji mi vatandaşlık mı'),
('kpss','answer','cografya','ayse','harita setindeyim, iklim soruları gidiyor'),
('kpss','share_progress','plan','selin','plan duruyor, {done} kestim');

create or replace function public.exam_chat_words(p text)
returns int
language sql
immutable
as $$
  select coalesce(cardinality(regexp_split_to_array(trim(coalesce(p, '')), '\s+')), 0);
$$;

create or replace function public.exam_chat_thread_title(p_slug text, p_thread text)
returns text
language sql
immutable
as $$
  select case coalesce(p_thread, '')
    when 'problem_hiz' then 'problem süresi'
    when 'paragraf' then 'paragraf'
    when 'geometri' then 'geometri'
    when 'deneme' then 'deneme sonucu'
    when 'tarih' then 'tarih'
    when 'cografya' then 'coğrafya'
    when 'fen' then 'fen'
    when 'turkce' then 'türkçe'
    when 'oda' then 'çalışma odası'
    when 'hedef' then 'günlük hedef'
    when 'mat' then 'matematik'
    when 'fizik' then 'fizik'
    when 'kimya' then 'kimya'
    when 'biyoloji' then 'biyoloji'
    when 'edebiyat' then 'edebiyat'
    when 'net' then 'netler'
    when 'vatandaslik' then 'vatandaşlık'
    when 'egitim' then 'eğitim bilimleri'
    when 'plan' then 'çalışma planı'
    else case p_slug when 'ayt' then 'ayt çalışma' when 'kpss' then 'kpss tekrar' else 'tyt çalışma' end
  end;
$$;

create or replace function public.exam_chat_has_anchor(p text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p, '')) ~ '(soru|deneme|paragraf|süre|dk|dakika|yanlış|net|harita|geometri|üçgen|tarih|coğraf|cograf|oda|hedef|test|konu|ders|problem|mat|fizik|kimya|biyoloji|optik|türev|integral|vatandaş|plan|analiz|tempo|yetiş|iklim|kronoloj|edebiyat|şiir)';
$$;

create or replace function public.exam_chat_vague(p_body text, p_prev text)
returns boolean
language plpgsql
immutable
as $$
declare
  v text := lower(trim(coalesce(p_body, '')));
  n int := public.exam_chat_words(p_body);
begin
  if v = '' then return true; end if;
  if n < 4 then return true; end if;
  if n > 22 then return true; end if;
  if v in ('anladım','hmm tamam','aynen ya','iyiymiş','ha öyle mi','olay bu ya','bende de öyle') then
    return true;
  end if;
  if v ~ 'gibi bende' then return true; end if;
  if v ~ 'doğru,? bende de tutuyor' then return true; end if;
  if v ~ 'bende de aynı yerdeyim' then return true; end if;
  if v ~ '(^| )(bende|onda|aynı|öyle|o kadar|buna|ona |şunu|bundan)'
     and not public.exam_chat_has_anchor(v)
  then
    return true;
  end if;
  if v ~ '^[0-9]+ gibi' then return true; end if;
  if public.exam_chat_has_anchor(v) then return false; end if;
  if n <= 5 and v ~ '(bende|onda|aynı|öyle)' then return true; end if;
  return false;
end;
$$;

create or replace function public.exam_chat_quality_fail(
  p_slug text,
  p_bot uuid,
  p_body text,
  p_prev text,
  p_thread text,
  p_intent text
)
returns boolean
language plpgsql
stable
as $$
declare
  v_mem public.exam_bot_memory;
  v_title text := public.exam_chat_thread_title(p_slug, p_thread);
  v_low text := lower(coalesce(p_body, ''));
begin
  if public.exam_chat_vague(p_body, p_prev) then return true; end if;
  if public.exam_chat_banned(p_body) then return true; end if;
  if public.group_line_too_similar(p_slug, p_body) then return true; end if;
  if coalesce(p_prev, '') <> '' and public.exam_chat_norm(p_body) = public.exam_chat_norm(p_prev) then
    return true;
  end if;
  if p_intent in ('change_topic','invite_to_room','joke') then
    return false;
  end if;
  if p_intent in ('answer','agree','continue_previous','ask_followup','ask_question')
     and coalesce(p_prev, '') <> ''
     and not public.exam_chat_has_anchor(p_body)
     and not public.exam_chat_has_anchor(p_prev)
  then
    return true;
  end if;
  select * into v_mem from public.exam_bot_memory where bot_id = p_bot and slug = p_slug;
  if found then
    if v_mem.last_meaning is not null
       and left(public.exam_chat_norm(p_body), 16) = left(public.exam_chat_norm(v_mem.last_meaning), 16)
    then
      return true;
    end if;
    if p_intent = 'share_progress'
       and v_mem.done is not null
       and v_low ~ '[0-9]+'
       and v_mem.last_result is not null
       and p_body not like '%' || v_mem.subject || '%'
       and p_body not like '%' || coalesce(v_title, '') || '%'
       and not public.exam_chat_has_anchor(p_body)
    then
      return true;
    end if;
  end if;
  return false;
end;
$$;

create or replace function public.group_line_too_similar(p_slug text, p_body text)
returns boolean
language plpgsql
stable
as $$
declare
  v text := public.exam_chat_norm(p_body);
  v_hit int;
begin
  if public.exam_chat_banned(p_body) then return true; end if;
  select count(*) into v_hit
  from (
    select body from public.exam_chat_messages where slug = p_slug order by created_at desc limit 24
  ) t
  where public.exam_chat_norm(t.body) = v
     or (length(v) >= 10 and left(public.exam_chat_norm(t.body), 18) = left(v, 18));
  return v_hit > 0;
end;
$$;

create or replace function public.exam_chat_build_summary(p_slug text)
returns text
language plpgsql
stable
as $$
declare
  v_out text;
begin
  select left(string_agg(x.clause, '. ' order by x.ord) || '.', 360) into v_out
  from (
    select
      row_number() over (order by m.created_at) as ord,
      coalesce(pr.display_name, 'biri') || ' ' ||
      case
        when m.body ~* '\?' then 'soru sordu'
        when m.body ~* 'oda' then 'oda konuştu'
        when m.body ~* 'deneme|/[0-9]|gitti' then 'sonuç paylaştı'
        when m.body ~* 'harita|coğraf' then 'coğrafyadan bahsetti'
        when m.body ~* 'süre|dk|yetiş|problem' then 'süre/problem konuştu'
        when m.body ~* 'paragraf' then 'paragrafa değindi'
        when m.body ~* 'yanlış|net' then 'yanlış/net söyledi'
        when m.body ~* 'tarih|kronoloj' then 'tarihten bahsetti'
        else 'devam etti'
      end as clause
    from (
      select id, sender_id, body, created_at
      from public.exam_chat_messages
      where slug = p_slug
        and created_at <= clock_timestamp()
      order by created_at desc
      limit 16
    ) m
    join public.profiles pr on pr.id = m.sender_id
  ) x;
  return nullif(v_out, '.');
end;
$$;

create or replace function public.exam_chat_plan_turn(
  p_slug text,
  p_persona text,
  p_prev_body text,
  p_topic_age int,
  p_unresolved text,
  p_current_thread text,
  out o_intent text,
  out o_relation text,
  out o_shift boolean,
  out o_thread text,
  out o_reply boolean
)
language plpgsql
stable
as $$
declare
  r float := random();
  v_q boolean := coalesce(p_prev_body, '') like '%?%' or coalesce(p_unresolved, '') <> '';
  v_share boolean := coalesce(p_prev_body, '') ~* '(gitti|/[0-9]|soru|yanlış|net|kestim|oldum|deneme)';
  v_need int := 3 + floor(random() * 6)::int;
begin
  o_thread := coalesce(p_current_thread, 'genel');
  o_shift := false;
  o_reply := true;

  if v_q then
    o_intent := case when r < 0.72 then 'answer' when r < 0.88 then 'agree' else 'share_progress' end;
    o_relation := 'answer';
    return;
  end if;

  if p_topic_age >= v_need then
    o_shift := true;
    o_thread := public.exam_chat_shift_thread(p_slug, o_thread);
    o_reply := false;
    o_intent := case
      when r < 0.42 then 'invite_to_room'
      when r < 0.78 then 'change_topic'
      else 'share_progress'
    end;
    o_relation := 'shift';
    if o_intent = 'invite_to_room' then o_thread := 'oda'; end if;
    return;
  end if;

  if v_share then
    if r < 0.36 then
      o_intent := 'ask_followup'; o_relation := 'clarify';
    elsif r < 0.68 then
      o_intent := 'share_progress'; o_relation := 'share_own';
    elsif r < 0.84 then
      o_intent := 'agree'; o_relation := 'agree_explicit';
    else
      o_intent := 'continue_previous'; o_relation := 'continue';
    end if;
    return;
  end if;

  if p_persona = 'kaan' and r < 0.28 then
    o_intent := 'ask_followup'; o_relation := 'clarify'; return;
  end if;
  if p_persona = 'selin' and r < 0.24 then
    o_intent := 'share_progress'; o_relation := 'share_own'; return;
  end if;
  if p_persona = 'can' and r < 0.22 then
    o_intent := 'joke'; o_relation := 'continue'; return;
  end if;
  if p_persona = 'ayse' and r < 0.18 then
    o_intent := 'ask_followup'; o_relation := 'clarify'; return;
  end if;

  r := random();
  if r < 0.28 then o_intent := 'ask_followup'; o_relation := 'clarify';
  elsif r < 0.52 then o_intent := 'share_progress'; o_relation := 'share_own';
  elsif r < 0.68 then o_intent := 'answer'; o_relation := 'answer';
  elsif r < 0.80 then o_intent := 'agree'; o_relation := 'agree_explicit';
  elsif r < 0.90 then o_intent := 'continue_previous'; o_relation := 'continue';
  else o_intent := 'encourage'; o_relation := 'continue';
  end if;
end;
$$;

drop function if exists public.exam_chat_fill(text, public.exam_bot_memory, text);

create or replace function public.exam_chat_fill(p_body text, p_mem public.exam_bot_memory, p_who text, p_topic text default null)
returns text
language plpgsql
stable
as $$
declare
  v text := coalesce(p_body, '');
  v_result text := coalesce(nullif(p_mem.last_result, ''), coalesce(p_mem.done, 8)::text || '/' || coalesce(p_mem.goal, 30)::text);
begin
  v := replace(v, '{dk}', coalesce(p_mem.minutes_per_set, 15)::text);
  v := replace(v, '{done}', coalesce(p_mem.done, 8)::text);
  v := replace(v, '{goal}', coalesce(p_mem.goal, 30)::text);
  v := replace(v, '{sub}', coalesce(p_mem.subject, 'ders'));
  v := replace(v, '{who}', coalesce(nullif(p_who, ''), 'sen'));
  v := replace(v, '{qnum}', coalesce(p_mem.question_number, 12)::text);
  v := replace(v, '{result}', v_result);
  v := replace(v, '{topic}', coalesce(p_topic, p_mem.topic, p_mem.subject, 'ders'));
  return v;
end;
$$;

create or replace function public.exam_chat_compose(
  p_slug text,
  p_bot uuid,
  p_attempt int,
  p_intent text,
  p_thread text,
  p_reply_body text,
  p_reply_name text
)
returns text
language plpgsql
as $$
declare
  v_name text;
  v_persona text;
  v_mem public.exam_bot_memory;
  v_line text;
  v_intent text := coalesce(p_intent, 'share_progress');
  v_thread text := coalesce(p_thread, 'genel');
  v_title text;
  rec record;
begin
  select display_name into v_name from public.profiles where id = p_bot;
  v_persona := public.exam_chat_persona(v_name);
  v_mem := public.exam_chat_ensure_memory(p_bot, p_slug);
  v_title := public.exam_chat_thread_title(p_slug, v_thread);

  if v_thread in ('cografya') then
    v_mem.subject := 'Coğrafya';
    v_mem.topic := 'Harita';
  elsif v_thread in ('paragraf','turkce') then
    v_mem.subject := 'Türkçe';
    v_mem.topic := 'Paragraf';
  elsif v_thread in ('problem_hiz','mat','hedef') then
    v_mem.subject := 'Matematik';
    v_mem.topic := 'Problemler';
  elsif v_thread = 'deneme' then
    v_mem.topic := 'Deneme';
  elsif v_thread = 'tarih' then
    v_mem.subject := 'Tarih';
  elsif v_thread = 'fizik' then
    v_mem.subject := 'Fizik';
  end if;

  if v_intent = 'share_progress' then
    v_mem.done := least(v_mem.goal + 4, greatest(v_mem.done, 4) + 2 + floor(random() * 4)::int);
    if v_mem.done >= v_mem.goal then
      v_mem.goal := v_mem.goal + 8;
    end if;
    v_mem.question_number := least(48, greatest(v_mem.question_number, 8) + 1 + floor(random() * 3)::int);
    v_mem.last_result := v_mem.done::text || '/' || v_mem.goal::text;
  end if;

  for rec in
    select b.body
    from public.exam_chat_line_bank b
    where (b.exam = p_slug or b.exam = '*')
      and b.intent = v_intent
      and (b.thread_key = v_thread or b.thread_key = '*')
      and (b.persona = v_persona or b.persona = '*')
    order by
      (b.thread_key = v_thread)::int desc,
      (b.persona = v_persona)::int desc,
      (abs(hashtext(p_bot::text || b.body || p_attempt::text)) % 1000)
  loop
    v_line := public.exam_chat_fill(rec.body, v_mem, p_reply_name, v_title);
    if not public.exam_chat_quality_fail(p_slug, p_bot, v_line, p_reply_body, v_thread, v_intent) then
      exit;
    end if;
    v_line := null;
  end loop;

  if v_line is null then
    v_line := case v_intent
      when 'ask_followup' then 'hangi dersten bahsediyorsun'
      when 'answer' then 'ben de ' || v_mem.subject || ' çalışıyorum şu an'
      when 'agree' then v_mem.subject || ' tarafı bende de ağır geldi'
      when 'share_progress' then 'bugün ' || v_mem.subject || ' ' || v_mem.done::text || ' soru kestim'
      when 'invite_to_room' then '10 dk sonra oda açsam gelen var mı'
      when 'change_topic' then 'bu arada ' || v_title || ' tarafına geçtim'
      when 'joke' then 'ben ' || v_mem.subject || ' saldım başka sete geçtim'
      when 'encourage' then 'planı bozmayın, ' || v_mem.subject || ' kısa tutun yeter'
      else 'ben de ' || v_title || ' tarafındayım şu an'
    end;
    if public.exam_chat_quality_fail(p_slug, p_bot, v_line, p_reply_body, v_thread, v_intent) then
      return null;
    end if;
  end if;

  v_mem.recent := (ARRAY[v_line] || coalesce(v_mem.recent, '{}'::text[]))[1:8];
  v_mem.last_meaning := v_line;
  v_mem.mood := case when v_intent = 'complain' then 'tired' else 'normal' end;
  update public.exam_bot_memory
  set subject = v_mem.subject,
      topic = v_mem.topic,
      goal = v_mem.goal,
      done = v_mem.done,
      minutes_per_set = v_mem.minutes_per_set,
      mood = v_mem.mood,
      recent = v_mem.recent,
      question_number = v_mem.question_number,
      last_result = v_mem.last_result,
      last_meaning = v_mem.last_meaning,
      updated_at = now()
  where bot_id = p_bot and slug = p_slug;

  return v_line;
end;
$$;

create or replace function public.exam_chat_touch_human(p_slug text, p_body text)
returns void
language plpgsql
as $$
declare
  v_th text;
  v_cur text;
begin
  insert into public.exam_chat_room_state (slug) values (p_slug) on conflict do nothing;
  v_th := public.exam_chat_thread_from_text(p_slug, p_body);
  select current_thread into v_cur from public.exam_chat_room_state where slug = p_slug;
  update public.exam_chat_room_state
  set current_thread = coalesce(v_th, current_thread),
      scene_topic = public.exam_chat_thread_title(p_slug, coalesce(v_th, current_thread)),
      last_human_at = now(),
      burst_left = greatest(burst_left, 3 + floor(random() * 3)::int),
      burst_bots = case
        when coalesce(array_length(burst_bots, 1), 0) >= 2 then burst_bots
        else public.exam_chat_pick_bots(p_slug, 3)
      end,
      topic_age = case
        when v_th is not null and v_th is distinct from v_cur then 0
        else topic_age
      end,
      unresolved_question = case when p_body like '%?' then left(p_body, 140) else unresolved_question end,
      thread_summary = public.exam_chat_build_summary(p_slug),
      mood = 'casual',
      next_eligible_at = least(coalesce(next_eligible_at, now() + interval '6 seconds'), now() + make_interval(secs => 4 + floor(random() * 8)::int)),
      updated_at = now()
  where slug = p_slug;
end;
$$;

create or replace function public.rewrite_stale_bot_chat()
returns trigger
language plpgsql
as $$
declare
  v_new text;
  v_th text;
begin
  if not exists (select 1 from public.profiles where id = new.sender_id and coalesce(is_bot, false)) then
    return new;
  end if;
  if not public.exam_chat_banned(new.body)
     and not public.exam_chat_vague(new.body, null)
     and not public.group_line_too_similar(new.slug, new.body) then
    return new;
  end if;
  select current_thread into v_th from public.exam_chat_room_state where slug = new.slug;
  v_new := public.exam_chat_compose(
    new.slug, new.sender_id, 4, 'share_progress', coalesce(v_th, 'genel'), null, null
  );
  if v_new is null then return null; end if;
  new.body := v_new;
  return new;
end;
$$;

create or replace function public.pulse_exam_chats()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_state public.exam_chat_room_state;
  v_bot uuid;
  v_prev uuid;
  v_prev_body text;
  v_prev_name text;
  v_prev_id uuid;
  v_prev_at timestamptz;
  v_intent text;
  v_thread text;
  v_shift boolean;
  v_relation text;
  v_reply_flag boolean;
  v_text text;
  v_try int;
  v_when timestamptz;
  v_delay int;
  v_reply uuid;
  v_name text;
  v_persona text;
  v_id uuid;
begin
  insert into public.exam_chat_room_state (slug)
  select g.slug from public.exam_chat_groups g
  on conflict do nothing;

  select s.slug into v_slug
  from public.exam_chat_room_state s
  where s.next_eligible_at is null or s.next_eligible_at <= clock_timestamp()
  order by
    (s.burst_left > 0) desc,
    coalesce(s.next_eligible_at, '2000-01-01'::timestamptz) asc,
    random()
  limit 1;
  if v_slug is null then return; end if;

  select * into v_state from public.exam_chat_room_state where slug = v_slug for update;

  select m.id, m.sender_id, m.body, m.created_at, pr.display_name
  into v_prev_id, v_prev, v_prev_body, v_prev_at, v_prev_name
  from public.exam_chat_messages m
  join public.profiles pr on pr.id = m.sender_id
  where m.slug = v_slug
  order by m.created_at desc
  limit 1;

  if v_prev_at is not null and v_prev_at > clock_timestamp() then
    update public.exam_chat_room_state
    set next_eligible_at = v_prev_at + make_interval(secs => 2 + floor(random() * 6)::int)
    where slug = v_slug;
    return;
  end if;

  if v_state.burst_left <= 0 then
    if random() < 0.28 then
      update public.exam_chat_room_state
      set next_eligible_at = clock_timestamp() + make_interval(secs => 50 + floor(random() * 100)::int),
          updated_at = now()
      where slug = v_slug;
      return;
    end if;
    v_state.burst_bots := public.exam_chat_pick_bots(v_slug, 2 + floor(random() * 3)::int);
    v_state.burst_left := 4 + floor(random() * 4)::int;
  end if;

  select x into v_bot
  from unnest(v_state.burst_bots) as x
  where x is distinct from v_prev
  order by random()
  limit 1;
  if v_bot is null then
    select x into v_bot from unnest(v_state.burst_bots) as x order by random() limit 1;
  end if;
  if v_bot is null then return; end if;

  select display_name into v_name from public.profiles where id = v_bot;
  v_persona := public.exam_chat_persona(v_name);

  select o_intent, o_relation, o_shift, o_thread, o_reply
  into v_intent, v_relation, v_shift, v_thread, v_reply_flag
  from public.exam_chat_plan_turn(
    v_slug,
    v_persona,
    v_prev_body,
    coalesce(v_state.topic_age, 0),
    v_state.unresolved_question,
    coalesce(v_state.current_thread, 'genel')
  );

  v_reply := null;
  if v_reply_flag and v_prev_id is not null and v_intent in ('answer','agree','ask_followup','continue_previous','share_progress') then
    v_reply := v_prev_id;
  end if;

  v_text := null;
  for v_try in 1..12 loop
    v_text := public.exam_chat_compose(v_slug, v_bot, v_try, v_intent, v_thread, v_prev_body, v_prev_name);
    exit when v_text is not null;
  end loop;
  if v_text is null then
    update public.exam_chat_room_state
    set burst_left = greatest(v_state.burst_left - 1, 0),
        next_eligible_at = clock_timestamp() + make_interval(secs => 18 + floor(random() * 36)::int),
        updated_at = now()
    where slug = v_slug;
    return;
  end if;

  if v_state.burst_left >= 4 then
    v_delay := 4 + floor(random() * 10)::int;
  else
    v_delay := 6 + floor(random() * 18)::int;
  end if;
  v_when := clock_timestamp() + make_interval(secs => v_delay);

  insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
  insert into public.exam_chat_messages (slug, sender_id, body, created_at, reply_to_id)
  values (v_slug, v_bot, v_text, v_when, v_reply)
  returning id into v_id;

  if v_state.burst_left - 1 <= 0 then
    update public.exam_chat_room_state
    set burst_left = 0,
        last_intent = v_intent,
        last_speaker = v_bot,
        current_thread = v_thread,
        scene_topic = public.exam_chat_thread_title(v_slug, v_thread),
        last_relation = v_relation,
        last_meaningful_id = v_id,
        topic_age = case when v_shift then 1 else coalesce(topic_age, 0) + 1 end,
        unresolved_question = case when v_text like '%?' then left(v_text, 140) else null end,
        thread_summary = public.exam_chat_build_summary(v_slug),
        next_eligible_at = v_when + make_interval(secs => 70 + floor(random() * 200)::int),
        burst_bots = '{}',
        updated_at = now()
    where slug = v_slug;
  else
    update public.exam_chat_room_state
    set burst_left = v_state.burst_left - 1,
        last_intent = v_intent,
        last_speaker = v_bot,
        current_thread = v_thread,
        scene_topic = public.exam_chat_thread_title(v_slug, v_thread),
        last_relation = v_relation,
        last_meaningful_id = v_id,
        topic_age = case when v_shift then 1 else coalesce(topic_age, 0) + 1 end,
        unresolved_question = case when v_text like '%?' then left(v_text, 140) else null end,
        thread_summary = public.exam_chat_build_summary(v_slug),
        burst_bots = v_state.burst_bots,
        next_eligible_at = v_when + make_interval(secs => 3 + floor(random() * 9)::int),
        updated_at = now()
    where slug = v_slug;
  end if;
end;
$$;

notify pgrst, 'reload schema';
