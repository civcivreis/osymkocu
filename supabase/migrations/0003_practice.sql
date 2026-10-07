-- Phase 4: question attempts, spaced repetition upsert, starter bank.

create unique index if not exists wrong_answers_user_question_idx
  on public.wrong_answers (user_id, question_id);

create unique index if not exists questions_exam_stem_idx
  on public.questions (exam_id, stem);

insert into public.topics (subject_id, slug, name, sort_order)
select sub.id, t.slug, t.name, t.sort_order
from public.subjects sub
join public.exams e on e.id = sub.exam_id
join (
  values
    ('tyt', 'turkce', 'dil-bilgisi', 'Dil Bilgisi', 1),
    ('tyt', 'turkce', 'anlam-bilgisi', 'Anlam Bilgisi', 2),
    ('tyt', 'matematik', 'koklu-sayilar', 'Köklü Sayılar', 3),
    ('kpss_lisans', 'turkce', 'dil-bilgisi', 'Dil Bilgisi', 1),
    ('kpss_lisans', 'turkce', 'anlam-bilgisi', 'Anlam Bilgisi', 2),
    ('kpss_lisans', 'vatandaslik', 'anayasa', 'Anayasa', 1),
    ('kpss_lisans', 'tarih', 'osmanli', 'Osmanlı', 1),
    ('kpss_onlisans', 'turkce', 'dil-bilgisi', 'Dil Bilgisi', 1),
    ('kpss_onlisans', 'turkce', 'anlam-bilgisi', 'Anlam Bilgisi', 2),
    ('kpss_onlisans', 'vatandaslik', 'anayasa', 'Anayasa', 1),
    ('kpss_onlisans', 'tarih', 'osmanli', 'Osmanlı', 1)
) as t(exam_slug, subject_slug, slug, name, sort_order)
  on t.exam_slug = e.slug and t.subject_slug = sub.slug
on conflict (subject_id, slug) do nothing;

create or replace function public._seed_question(
  p_exam_slug text,
  p_subject_slug text,
  p_topic_slug text,
  p_stem text,
  p_choices jsonb,
  p_correct text,
  p_explanation text,
  p_difficulty public.difficulty default 'medium'
)
returns void
language plpgsql
as $$
begin
  insert into public.questions (
    exam_id, subject_id, topic_id, stem, choices, correct_choice, explanation, difficulty, source, is_published
  )
  select e.id, s.id, t.id, p_stem, p_choices, p_correct, p_explanation, p_difficulty, 'kocum-seed', true
  from public.exams e
  join public.subjects s on s.exam_id = e.id and s.slug = p_subject_slug
  left join public.topics t on t.subject_id = s.id and t.slug = p_topic_slug
  where e.slug = p_exam_slug
  on conflict (exam_id, stem) do nothing;
end;
$$;

select public._seed_question('tyt', 'matematik', 'uslu-sayilar',
  '2³ · 2² işleminin sonucu kaçtır?',
  '{"A":"16","B":"32","C":"8","D":"64","E":"24"}'::jsonb, 'B',
  'Üslü sayılarda tabanlar eşitse üsler toplanır: 2³ · 2² = 2⁵ = 32.', 'easy');

select public._seed_question('tyt', 'matematik', 'uslu-sayilar',
  '(3²)³ ifadesinin değeri nedir?',
  '{"A":"18","B":"81","C":"243","D":"729","E":"27"}'::jsonb, 'D',
  'Üs üssü alınırken üsler çarpılır: (3²)³ = 3⁶ = 729.', 'medium');

select public._seed_question('tyt', 'matematik', 'uslu-sayilar',
  '2⁻³ hangisine eşittir?',
  '{"A":"-8","B":"-6","C":"1/8","D":"1/6","E":"8"}'::jsonb, 'C',
  'Negatif üs, sayının çarpmaya göre tersidir: 2⁻³ = 1 / 2³ = 1/8.', 'easy');

select public._seed_question('tyt', 'matematik', 'koklu-sayilar',
  '√49 + √16 işleminin sonucu kaçtır?',
  '{"A":"9","B":"11","C":"13","D":"65","E":"7"}'::jsonb, 'B',
  '√49 = 7 ve √16 = 4 olduğu için 7 + 4 = 11.', 'easy');

select public._seed_question('tyt', 'matematik', 'problemler',
  'Bir işi 8 işçi 12 günde bitiriyor. Aynı işi 6 işçi kaç günde bitirir?',
  '{"A":"14","B":"15","C":"16","D":"18","E":"20"}'::jsonb, 'C',
  'İş miktarı 8 · 12 = 96 işçi-gün. 96 / 6 = 16 gün.', 'medium');

select public._seed_question('tyt', 'turkce', 'dil-bilgisi',
  'Aşağıdaki cümlelerin hangisinde yazım yanlışı vardır?',
  '{"A":"Bu yıl da başarılı olacağına inanıyorum.","B":"Herşey yolunda gidiyor gibiydi.","C":"Toplantı yarın saat ikide başlayacak.","D":"Kitabı dikkatle okudu.","E":"Hava bugün oldukça soğuktu."}'::jsonb, 'B',
  '"Her şey" ayrı yazılır. "Herşey" bitişik yazımı yanlıştır.', 'easy');

select public._seed_question('tyt', 'turkce', 'anlam-bilgisi',
  '"Cömert" sözcüğünün anlamca zıt karşılığı hangisidir?',
  '{"A":"Eli açık","B":"Cimri","C":"Yardımsever","D":"Misafirperver","E":"İyi niyetli"}'::jsonb, 'B',
  'Cömert, malını paylaşmayı seven kişidir. Zıt anlamlısı cimridir.', 'easy');

select public._seed_question('kpss_lisans', 'matematik', 'uslu-sayilar',
  '2³ · 2² işleminin sonucu kaçtır?',
  '{"A":"16","B":"32","C":"8","D":"64","E":"24"}'::jsonb, 'B',
  'Üslü sayılarda tabanlar eşitse üsler toplanır: 2³ · 2² = 2⁵ = 32.', 'easy');

select public._seed_question('kpss_lisans', 'matematik', 'uslu-sayilar',
  '(3²)³ ifadesinin değeri nedir?',
  '{"A":"18","B":"81","C":"243","D":"729","E":"27"}'::jsonb, 'D',
  'Üs üssü alınırken üsler çarpılır: (3²)³ = 3⁶ = 729.', 'medium');

select public._seed_question('kpss_lisans', 'matematik', 'uslu-sayilar',
  '2⁻³ hangisine eşittir?',
  '{"A":"-8","B":"-6","C":"1/8","D":"1/6","E":"8"}'::jsonb, 'C',
  'Negatif üs, sayının çarpmaya göre tersidir: 2⁻³ = 1 / 2³ = 1/8.', 'easy');

select public._seed_question('kpss_lisans', 'matematik', 'koklu-sayilar',
  '√49 + √16 işleminin sonucu kaçtır?',
  '{"A":"9","B":"11","C":"13","D":"65","E":"7"}'::jsonb, 'B',
  '√49 = 7 ve √16 = 4 olduğu için 7 + 4 = 11.', 'easy');

select public._seed_question('kpss_lisans', 'matematik', 'problemler',
  'Bir işi 8 işçi 12 günde bitiriyor. Aynı işi 6 işçi kaç günde bitirir?',
  '{"A":"14","B":"15","C":"16","D":"18","E":"20"}'::jsonb, 'C',
  'İş miktarı 8 · 12 = 96 işçi-gün. 96 / 6 = 16 gün.', 'medium');

select public._seed_question('kpss_lisans', 'turkce', 'dil-bilgisi',
  'Aşağıdaki cümlelerin hangisinde yazım yanlışı vardır?',
  '{"A":"Bu yıl da başarılı olacağına inanıyorum.","B":"Herşey yolunda gidiyor gibiydi.","C":"Toplantı yarın saat ikide başlayacak.","D":"Kitabı dikkatle okudu.","E":"Hava bugün oldukça soğuktu."}'::jsonb, 'B',
  '"Her şey" ayrı yazılır. "Herşey" bitişik yazımı yanlıştır.', 'easy');

select public._seed_question('kpss_lisans', 'turkce', 'anlam-bilgisi',
  '"Cömert" sözcüğünün anlamca zıt karşılığı hangisidir?',
  '{"A":"Eli açık","B":"Cimri","C":"Yardımsever","D":"Misafirperver","E":"İyi niyetli"}'::jsonb, 'B',
  'Cömert, malını paylaşmayı seven kişidir. Zıt anlamlısı cimridir.', 'easy');

select public._seed_question('kpss_lisans', 'vatandaslik', 'anayasa',
  'Türkiye’de yasama yetkisi aşağıdakilerden hangisine aittir?',
  '{"A":"Cumhurbaşkanı","B":"Anayasa Mahkemesi","C":"TBMM","D":"Bakanlar Kurulu","E":"Danıştay"}'::jsonb, 'C',
  '1982 Anayasası’na göre yasama yetkisi Türk milleti adına Türkiye Büyük Millet Meclisi’ndedir.', 'easy');

select public._seed_question('kpss_lisans', 'vatandaslik', 'anayasa',
  'Türkiye Cumhuriyeti Anayasası’na göre egemenlik kayıtsız şartsız kime aittir?',
  '{"A":"TBMM’ye","B":"Cumhurbaşkanına","C":"Millete","D":"Hükümete","E":"Yargıya"}'::jsonb, 'C',
  'Anayasa’nın 6. maddesi: Egemenlik kayıtsız şartsız Milletindir.', 'easy');

select public._seed_question('kpss_lisans', 'tarih', 'osmanli',
  'İstanbul’un fethi hangi yılda gerçekleşmiştir?',
  '{"A":"1071","B":"1299","C":"1453","D":"1517","E":"1683"}'::jsonb, 'C',
  'İstanbul, 1453’te II. Mehmet (Fatih) tarafından fethedilmiştir.', 'easy');

select public._seed_question('kpss_onlisans', 'matematik', 'uslu-sayilar',
  '2³ · 2² işleminin sonucu kaçtır?',
  '{"A":"16","B":"32","C":"8","D":"64","E":"24"}'::jsonb, 'B',
  'Üslü sayılarda tabanlar eşitse üsler toplanır: 2³ · 2² = 2⁵ = 32.', 'easy');

select public._seed_question('kpss_onlisans', 'matematik', 'problemler',
  'Bir işi 8 işçi 12 günde bitiriyor. Aynı işi 6 işçi kaç günde bitirir?',
  '{"A":"14","B":"15","C":"16","D":"18","E":"20"}'::jsonb, 'C',
  'İş miktarı 8 · 12 = 96 işçi-gün. 96 / 6 = 16 gün.', 'medium');

select public._seed_question('kpss_onlisans', 'turkce', 'dil-bilgisi',
  'Aşağıdaki cümlelerin hangisinde yazım yanlışı vardır?',
  '{"A":"Bu yıl da başarılı olacağına inanıyorum.","B":"Herşey yolunda gidiyor gibiydi.","C":"Toplantı yarın saat ikide başlayacak.","D":"Kitabı dikkatle okudu.","E":"Hava bugün oldukça soğuktu."}'::jsonb, 'B',
  '"Her şey" ayrı yazılır. "Herşey" bitişik yazımı yanlıştır.', 'easy');

select public._seed_question('kpss_onlisans', 'vatandaslik', 'anayasa',
  'Türkiye’de yasama yetkisi aşağıdakilerden hangisine aittir?',
  '{"A":"Cumhurbaşkanı","B":"Anayasa Mahkemesi","C":"TBMM","D":"Bakanlar Kurulu","E":"Danıştay"}'::jsonb, 'C',
  '1982 Anayasası’na göre yasama yetkisi Türk milleti adına Türkiye Büyük Millet Meclisi’ndedir.', 'easy');

select public._seed_question('kpss_onlisans', 'tarih', 'osmanli',
  'İstanbul’un fethi hangi yılda gerçekleşmiştir?',
  '{"A":"1071","B":"1299","C":"1453","D":"1517","E":"1683"}'::jsonb, 'C',
  'İstanbul, 1453’te II. Mehmet (Fatih) tarafından fethedilmiştir.', 'easy');

drop function if exists public._seed_question(text, text, text, text, jsonb, text, text, public.difficulty);

create or replace function public.submit_question_attempt(
  p_question_id uuid,
  p_selected_choice text,
  p_time_spent_ms int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_question public.questions%rowtype;
  v_correct boolean;
  v_choice text;
  v_xp int := 0;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  v_choice := upper(trim(p_selected_choice));
  if v_choice is null or v_choice not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'INVALID_CHOICE';
  end if;

  select * into v_question
  from public.questions
  where id = p_question_id and is_published = true;

  if not found then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  v_correct := upper(trim(v_question.correct_choice)) = v_choice;

  insert into public.question_attempts (user_id, question_id, selected_choice, is_correct, time_spent_ms)
  values (v_user, p_question_id, v_choice, v_correct, p_time_spent_ms);

  update public.user_stats
  set questions_solved = questions_solved + 1,
      questions_correct = questions_correct + case when v_correct then 1 else 0 end,
      updated_at = now()
  where user_id = v_user;

  if v_correct then
    v_xp := 2;
    insert into public.xp_transactions (user_id, amount, reason, metadata)
    values (v_user, v_xp, 'question', jsonb_build_object('question_id', p_question_id));

    update public.profiles
    set current_xp = current_xp + v_xp
    where id = v_user;

    delete from public.wrong_answers
    where user_id = v_user and question_id = p_question_id;
  else
    insert into public.wrong_answers (
      user_id, question_id, exam_id, subject_id, topic_id,
      user_answer, correct_answer, explanation, difficulty,
      next_review_at, interval_days, ease_factor, repetitions
    )
    values (
      v_user, p_question_id, v_question.exam_id, v_question.subject_id, v_question.topic_id,
      v_choice, v_question.correct_choice, v_question.explanation, v_question.difficulty,
      now() + interval '1 day', 1, 2.5, 0
    )
    on conflict (user_id, question_id) do update
      set user_answer = excluded.user_answer,
          correct_answer = excluded.correct_answer,
          explanation = excluded.explanation,
          next_review_at = now() + interval '1 day',
          interval_days = 1,
          repetitions = 0;
  end if;

  return jsonb_build_object(
    'is_correct', v_correct,
    'correct_choice', v_question.correct_choice,
    'explanation', v_question.explanation,
    'xp_awarded', v_xp,
    'difficulty', v_question.difficulty
  );
end;
$$;

revoke all on function public.submit_question_attempt(uuid, text, int) from public;
grant execute on function public.submit_question_attempt(uuid, text, int) to authenticated;

notify pgrst, 'reload schema';
