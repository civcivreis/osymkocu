-- Group-chat conversation engine: plan → compose, burst timing, bot memory, replies.
-- Paste after 0022. Removes template spam from pulse_bots.

alter table public.exam_chat_messages
  add column if not exists reply_to_id uuid references public.exam_chat_messages(id) on delete set null;

create index if not exists exam_chat_messages_reply_idx
  on public.exam_chat_messages (slug, reply_to_id);

create table if not exists public.exam_chat_room_state (
  slug text primary key references public.exam_chat_groups(slug) on delete cascade,
  current_thread text not null default 'genel',
  last_intent text,
  last_speaker uuid,
  last_human_at timestamptz,
  burst_left int not null default 0,
  burst_bots uuid[] not null default '{}',
  next_eligible_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.exam_chat_room_state (slug, current_thread) values
  ('tyt', 'problem_hiz'),
  ('ayt', 'mat'),
  ('kpss', 'tarih')
on conflict (slug) do nothing;

create table if not exists public.exam_bot_memory (
  bot_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null references public.exam_chat_groups(slug) on delete cascade,
  subject text not null default 'Matematik',
  topic text not null default 'Problemler',
  goal int not null default 30,
  done int not null default 8,
  minutes_per_set int not null default 15,
  mood text not null default 'normal',
  recent text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (bot_id, slug)
);

create table if not exists public.exam_chat_line_bank (
  id bigserial primary key,
  exam text not null,
  intent text not null,
  thread_key text not null default '*',
  persona text not null default '*',
  body text not null
);

create index if not exists exam_chat_line_bank_idx
  on public.exam_chat_line_bank (exam, intent, thread_key, persona);

alter table public.exam_chat_room_state enable row level security;
alter table public.exam_bot_memory enable row level security;
alter table public.exam_chat_line_bank enable row level security;

truncate public.exam_chat_line_bank;

insert into public.exam_chat_line_bank (exam, intent, thread_key, persona, body) values
-- generic
('*','agree','*','*','bende de öyle'),
('*','agree','*','*','aynen ya'),
('*','agree','*','*','doğru, bende de tutuyor'),
('*','agree','*','*','katılıyorum buna'),
('*','agree','*','mert','evet bende de öyle oldu'),
('*','disagree','*','*','bende tersi biraz'),
('*','disagree','*','*','ben öyle yapmıyorum'),
('*','disagree','*','*','emin değilim, bende tutmuyor'),
('*','disagree','*','kaan','yok bende öyle gitmiyor'),
('*','react','*','*','hmm tamam'),
('*','react','*','*','iyiymiş'),
('*','react','*','*','ha öyle mi'),
('*','react','*','*','anladım'),
('*','react','*','can','olay bu ya'),
('*','encourage','*','*','bırakmayın sonra denemede ağlıyoruz'),
('*','encourage','*','*','bugün çok gitmiyorsa 10 soru çöz bırak'),
('*','encourage','*','selin','planı bozmayın, kısa tutun yeter'),
('*','encourage','*','ayse','devam edin bence, tempo gelir'),
('*','complain','*','*','bugün hiç gitmiyor ya'),
('*','complain','*','*','kafam dağıldı biraz'),
('*','complain','*','*','netler yerinde sayıyor'),
('*','complain','*','kaan','sıkıldım bu settten'),
('*','joke','*','*','az kaldı zaten bırakacam nerdeyse'),
('*','joke','*','can','ben bunu saldım şu an başka sete geçtim 😂'),
('*','joke','*','can','ciddi ciddi koptum az önce'),
('*','side_comment','*','*','bu arada deneme saati seven var mı'),
('*','side_comment','*','*','ben mola verip su içiyorum'),
('*','continue_previous','*','*','evet ondan bahsediyorum'),
('*','continue_previous','*','mert','kısa cevap: bende tempo tutunca düzeliyor'),
('*','answer','*','*','bende de aynı yerdeyim'),
('*','answer','*','mert','{dk} falan, ilk başta yetişmiyordu zaten'),
('*','answer','*','mert','ben {dk} dk civarıyım'),
('*','answer','*','*','{dk} gibi bende'),
('*','answer','*','kaan','ben {dk} tutuyorum ama yetişmiyor bazen'),
('*','ask_for_help','*','kaan','siz nasıl yapıyorsunuz bunu'),
('*','ask_for_help','*','*','takıldım, kısa tarif eden var mı'),
('*','invite_to_room','*','ayse','bu arada akşam oda açan var mı'),
('*','invite_to_room','*','*','9 gibi gelirim ben'),
('*','invite_to_room','*','mert','bana uyar'),
('*','invite_to_room','*','can','gelirim kısa bakıp çıkarım'),
('*','invite_to_room','*','selin','planıma uyar, yazarım'),
('*','share_progress','*','*','{sub} {done} sorudayım hedef {goal}'),
('*','share_progress','*','selin','bugün {done}/{goal} gitti, plan duruyor'),
('*','share_progress','*','mert','{done} oldu, idare eder'),
('*','share_progress','*','kaan','{done} kestim az kaldı'),
('*','change_topic','*','can','ben bunu bıraktım şu an başka yere geçiyorum 😂'),
('*','change_topic','*','*','ben konuyu değiştim biraz'),
-- tyt threads
('tyt','ask_question','problem_hiz','kaan','problemlerde hızlanamıyorum ya siz nasıl çözüyorsunuz'),
('tyt','ask_question','problem_hiz','*','10 probleme kaç dk veriyorsunuz'),
('tyt','ask_question','problem_hiz','ayse','kaç dk veriyorsun 10 soruya'),
('tyt','answer','problem_hiz','mert','ben süre tutmaya başlayınca biraz düzeldi'),
('tyt','answer','problem_hiz','mert','15 falan, ilk başta yetişmiyordu zaten'),
('tyt','answer','problem_hiz','*','süre tutunca bende de oturdu'),
('tyt','continue_previous','problem_hiz','kaan','ben de bırakacam az kaldı zaten'),
('tyt','continue_previous','problem_hiz','*','aynı tempoyla gidiyorum'),
('tyt','share_progress','problem_hiz','*','problem {done} oldu'),
('tyt','share_progress','problem_hiz','elif','mat problem {done} kestim'),
('tyt','side_comment','problem_hiz','can','ben problemi saldım şu an paragraf çözüyorum 😂'),
('tyt','change_topic','paragraf','can','ben problem bıraktım şu an paragraf çözüyorum 😂'),
('tyt','ask_question','paragraf','*','paragrafta tempo tutan var mı'),
('tyt','answer','paragraf','*','ben süre tutunca net geliyor paragrafta'),
('tyt','share_progress','paragraf','can','paragraf {done} sorudayım'),
('tyt','ask_question','geometri','kaan','üçgende takıldım, çizen var mı'),
('tyt','answer','geometri','*','şekil çizmeden gitmeyin bende oradan kaçıyor'),
('tyt','share_progress','geometri','kaan','geometri {done} kaldı az'),
('tyt','ask_question','deneme','*','denemede geometri nasıldı sizce'),
('tyt','answer','deneme','burak','ben yanlışları ayıklıyorum şimdi'),
('tyt','share_progress','deneme','selin','deneme sonrası analiz yazıyorum kısa'),
('tyt','ask_question','tarih','*','tarih ezberi mi banka mı tutuyor sizde'),
('tyt','share_progress','tarih','mert','kronoloji tarıyorum yavaş yavaş'),
('tyt','ask_question','cografya','ayse','harita setine bakıyorum kimde kaldı'),
('tyt','share_progress','cografya','ayse','iklim soruları gidiyor bende'),
('tyt','ask_question','turkce','*','anlam bilgisi bugün yavaş, sizde nasıl'),
('tyt','share_progress','turkce','*','türkçe {done} kestim'),
('tyt','ask_question','fen','*','fen için kısa tekrar yeterli olur mu'),
('tyt','answer','fen','*','ben kısa tekrar + 10 soru yapıyorum'),
('tyt','invite_to_room','oda','ayse','akşam matematik odası açan var mı'),
('tyt','invite_to_room','oda','*','öğleden sonra tarih odası düşünen var mı'),
('tyt','answer','oda','can','9 gibi gelirim ben'),
('tyt','answer','oda','mert','bana uyar'),
('tyt','ask_question','hedef','selin','bugün kaç soru hedefiniz'),
('tyt','share_progress','hedef','selin','hedef {goal}, {done} bitti'),
('tyt','change_topic','paragraf','*','ben paragraf tarafına geçtim'),
('tyt','change_topic','tarih','mert','ben tarihe döndüm biraz'),
('tyt','change_topic','cografya','ayse','haritaya bakıyorum şu an'),
('tyt','change_topic','fen','*','kısa fen tekrarına geçtim'),
('tyt','joke','problem_hiz','can','problem bitti bende, paragraf daha kolay geldi 😂'),
-- ayt
('ayt','ask_question','mat','*','ayt mat bugün nasıl gidiyor sizde'),
('ayt','ask_question','mat','kaan','türevde takıldım, kim bakıyor'),
('ayt','answer','mat','mert','konu tekrarını bitirip teste geçiyorum'),
('ayt','share_progress','mat','*','ayt mat {done}/{goal}'),
('ayt','ask_question','fizik','zeynep','optikte kim var bugün'),
('ayt','answer','fizik','*','optik biraz ağır, yavaş gidiyorum'),
('ayt','share_progress','fizik','zeynep','fizik {done} sorudayım'),
('ayt','ask_question','kimya','defne','mol hesabına dönen var mı'),
('ayt','share_progress','kimya','defne','kimya {done} kestim'),
('ayt','ask_question','biyoloji','*','sistemler tekrar, kısa set yapan var mı'),
('ayt','share_progress','biyoloji','*','biyoloji tekrar {done}'),
('ayt','ask_question','edebiyat','selin','edebiyat notlarını tarayan var mı'),
('ayt','share_progress','edebiyat','selin','şiir bilgisi tarıyorum'),
('ayt','ask_question','deneme','burak','denemede ayt mat nasıldı sizce'),
('ayt','answer','deneme','*','yanlış analizini yeni yazıyorum'),
('ayt','ask_question','net','*','netler yerinde durunca moral bozuluyor kimde öyle'),
('ayt','encourage','net','selin','net için panik yok, set bitir yeter'),
('ayt','invite_to_room','oda','ayse','akşam fizik odası açsam gelen olur mu'),
('ayt','answer','oda','*','gelirim, kısa bakacağım'),
('ayt','change_topic','fizik','*','ben fiziğe geçtim'),
('ayt','change_topic','kimya','defne','kimyaya döndüm biraz'),
('ayt','change_topic','edebiyat','selin','edebiyat notuna bakıyorum'),
('ayt','side_comment','mat','can','türev durdu bende, kısa mola'),
('ayt','joke','fizik','can','optiği kapatıp biyoloji açtım 😂'),
-- kpss
('kpss','ask_question','tarih','mert','güncel tarih tekrar, kimde kaldı'),
('kpss','share_progress','tarih','mert','kronoloji {done} not aldım'),
('kpss','ask_question','cografya','ayse','iklim + harita giden var mı'),
('kpss','share_progress','cografya','ayse','harita {done} soru'),
('kpss','ask_question','vatandaslik','emre','vatandaşlık maddelerine bakan var mı'),
('kpss','share_progress','vatandaslik','emre','anayasa kısa tekrar, sonra test'),
('kpss','ask_question','turkce','*','kpss türkçe tempo nasıl sizde'),
('kpss','share_progress','turkce','*','türkçe {done} gitti'),
('kpss','ask_question','mat','*','kpss mat kim çalışıyor'),
('kpss','share_progress','mat','elif','mat {done}/{goal}'),
('kpss','ask_question','deneme','burak','akşam deneme çözen var mı'),
('kpss','answer','deneme','*','yanlış defteri tutuyorum deneme sonrası'),
('kpss','ask_question','plan','selin','çalışma planını netleştiren var mı bu hafta'),
('kpss','share_progress','plan','selin','plan duruyor, {done} kestim'),
('kpss','ask_question','egitim','*','eğitim bilimleri notu açık olan var mı'),
('kpss','share_progress','egitim','*','eb notu tarıyorum'),
('kpss','invite_to_room','oda','ayse','oda açsam kpss mat çözen gelir mi'),
('kpss','answer','oda','emre','gelirim vatandaşlık da bakarım'),
('kpss','change_topic','vatandaslik','emre','ben vatandaşlığa geçtim'),
('kpss','change_topic','cografya','ayse','haritaya bakıyorum şu an'),
('kpss','change_topic','tarih','mert','tarihe döndüm'),
('kpss','joke','plan','can','planı bozdum biraz, kısa set yeter 😂'),
('kpss','complain','deneme','*','deneme neti yerinde saydı bugün'),
('kpss','encourage','plan','selin','planı bozmadan gidin, 20 bile yeter');

create or replace function public.exam_chat_norm(p text)
returns text
language sql
immutable
as $$
  select left(regexp_replace(lower(translate(coalesce(p, ''), 'İIı', 'iii')), '[^a-z0-9çğıöşü]', '', 'g'), 36);
$$;

create or replace function public.exam_chat_banned(p text)
returns boolean
language sql
immutable
as $$
  select public.exam_chat_norm(p) in (
    public.exam_chat_norm('Bugün 20 soru daha.'),
    public.exam_chat_norm('Kaynak dağıtmadan gidin.'),
    public.exam_chat_norm('Matematik seti nasıl gidiyor?'),
    public.exam_chat_norm('Kim oda açtı?'),
    public.exam_chat_norm('Kim coğrafya odası açtı?'),
    public.exam_chat_norm('Deneme analizi yazan var mı?'),
    public.exam_chat_norm('Bugün 30 soru hedefim.')
  )
  or public.exam_chat_norm(p) like '%20sorudaha%'
  or public.exam_chat_norm(p) like '%kaynakdagitmadan%'
  or public.exam_chat_norm(p) like '%matematiksetinasil%';
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
  if length(v) < 8 then return false; end if;
  select count(*) into v_hit
  from (
    select body from public.exam_chat_messages where slug = p_slug order by created_at desc limit 30
  ) t
  where left(public.exam_chat_norm(t.body), 20) = left(v, 20)
     or public.exam_chat_norm(t.body) = v;
  return v_hit > 0;
end;
$$;

create or replace function public.exam_chat_persona(p_name text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_name, ''))
    when 'kaan' then 'kaan'
    when 'mert' then 'mert'
    when 'ayşe' then 'ayse'
    when 'can' then 'can'
    when 'selin' then 'selin'
    when 'elif' then 'elif'
    when 'zeynep' then 'zeynep'
    when 'emre' then 'emre'
    when 'defne' then 'defne'
    when 'burak' then 'burak'
    else 'other'
  end;
$$;

create or replace function public.exam_chat_thread_from_text(p_slug text, p_body text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_body, ''));
begin
  if p_slug = 'tyt' then
    if v ~ 'problem|süre|dk|dakika|hız' then return 'problem_hiz'; end if;
    if v ~ 'paragraf' then return 'paragraf'; end if;
    if v ~ 'geometri|üçgen' then return 'geometri'; end if;
    if v ~ 'deneme' then return 'deneme'; end if;
    if v ~ 'tarih|osmanlı|kronoloj' then return 'tarih'; end if;
    if v ~ 'coğraf|harita|iklim' then return 'cografya'; end if;
    if v ~ 'fen |fizik|kimya|biyoloji' then return 'fen'; end if;
    if v ~ 'türkçe|anlam' then return 'turkce'; end if;
    if v ~ 'oda' then return 'oda'; end if;
    if v ~ 'hedef|soru' then return 'hedef'; end if;
    return null;
  elsif p_slug = 'ayt' then
    if v ~ 'türev|integral|ayt mat|matematik' then return 'mat'; end if;
    if v ~ 'fizik|optik' then return 'fizik'; end if;
    if v ~ 'kimya|mol' then return 'kimya'; end if;
    if v ~ 'biyoloji|sistem' then return 'biyoloji'; end if;
    if v ~ 'edebiyat|şiir' then return 'edebiyat'; end if;
    if v ~ 'deneme' then return 'deneme'; end if;
    if v ~ 'net' then return 'net'; end if;
    if v ~ 'oda' then return 'oda'; end if;
    return null;
  else
    if v ~ 'vatandaş|anayasa' then return 'vatandaslik'; end if;
    if v ~ 'coğraf|harita|iklim' then return 'cografya'; end if;
    if v ~ 'tarih|kronoloj' then return 'tarih'; end if;
    if v ~ 'eğitim bilim|eb ' then return 'egitim'; end if;
    if v ~ 'plan' then return 'plan'; end if;
    if v ~ 'deneme' then return 'deneme'; end if;
    if v ~ 'türkçe' then return 'turkce'; end if;
    if v ~ 'mat' then return 'mat'; end if;
    if v ~ 'oda' then return 'oda'; end if;
    return null;
  end if;
end;
$$;

create or replace function public.exam_chat_shift_thread(p_slug text, p_current text)
returns text
language plpgsql
stable
as $$
declare
  v_pool text[];
  v_pick text;
begin
  if p_slug = 'tyt' then
    v_pool := array['problem_hiz','paragraf','geometri','deneme','tarih','cografya','fen','turkce'];
  elsif p_slug = 'ayt' then
    v_pool := array['mat','fizik','kimya','biyoloji','edebiyat','deneme'];
  else
    v_pool := array['tarih','cografya','vatandaslik','turkce','mat','deneme','plan','egitim'];
  end if;
  v_pool := array(select x from unnest(v_pool) x where x is distinct from p_current);
  if coalesce(array_length(v_pool, 1), 0) < 1 then return p_current; end if;
  v_pick := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];
  return v_pick;
end;
$$;

create or replace function public.exam_chat_ensure_memory(p_bot uuid, p_slug text)
returns public.exam_bot_memory
language plpgsql
as $$
declare
  v public.exam_bot_memory;
  v_name text;
  v_persona text;
begin
  select * into v from public.exam_bot_memory where bot_id = p_bot and slug = p_slug;
  if found then return v; end if;
  select display_name into v_name from public.profiles where id = p_bot;
  v_persona := public.exam_chat_persona(v_name);
  insert into public.exam_bot_memory (bot_id, slug, subject, topic, goal, done, minutes_per_set, mood)
  values (
    p_bot,
    p_slug,
    case
      when v_persona in ('elif','kaan','mert') and p_slug <> 'kpss' then 'Matematik'
      when v_persona = 'ayse' then 'Coğrafya'
      when v_persona = 'can' then 'Türkçe'
      when v_persona = 'selin' and p_slug = 'ayt' then 'Edebiyat'
      when v_persona = 'selin' then 'Matematik'
      when v_persona = 'zeynep' then 'Fizik'
      when v_persona = 'defne' then 'Kimya'
      when v_persona = 'emre' then 'Vatandaşlık'
      when v_persona = 'burak' then 'Deneme'
      when p_slug = 'kpss' then 'Tarih'
      else 'Matematik'
    end,
    case
      when v_persona in ('kaan','mert','elif') then 'Problemler'
      when v_persona = 'can' then 'Paragraf'
      else 'Tekrar'
    end,
    20 + (abs(hashtext(p_bot::text || p_slug)) % 21),
    6 + (abs(hashtext(p_slug || p_bot::text)) % 12),
    10 + (abs(hashtext(p_bot::text)) % 8),
    'normal'
  )
  on conflict (bot_id, slug) do nothing;
  select * into v from public.exam_bot_memory where bot_id = p_bot and slug = p_slug;
  return v;
end;
$$;

create or replace function public.exam_chat_fill(p_body text, p_mem public.exam_bot_memory, p_who text)
returns text
language plpgsql
stable
as $$
declare
  v text := coalesce(p_body, '');
begin
  v := replace(v, '{dk}', coalesce(p_mem.minutes_per_set, 15)::text);
  v := replace(v, '{done}', coalesce(p_mem.done, 8)::text);
  v := replace(v, '{goal}', coalesce(p_mem.goal, 30)::text);
  v := replace(v, '{sub}', coalesce(p_mem.subject, 'ders'));
  v := replace(v, '{who}', coalesce(nullif(p_who, ''), 'sen'));
  return v;
end;
$$;

create or replace function public.exam_chat_pick_intent(
  p_persona text,
  p_last_body text,
  p_burst_left int,
  p_thread_age int,
  p_allow_shift boolean
)
returns text
language plpgsql
stable
as $$
declare
  r float := random();
  v_q boolean := coalesce(p_last_body, '') like '%?%';
begin
  if v_q then
    if r < 0.48 then return 'answer'; end if;
    if r < 0.62 then return 'agree'; end if;
    if r < 0.72 then return 'continue_previous'; end if;
    if r < 0.80 then return 'disagree'; end if;
    if r < 0.88 then return 'react'; end if;
    if r < 0.94 then return 'joke'; end if;
    return 'side_comment';
  end if;

  if p_persona = 'kaan' and r < 0.22 then return 'ask_question'; end if;
  if p_persona = 'kaan' and r < 0.32 then return 'ask_for_help'; end if;
  if p_persona = 'mert' and r < 0.28 then return 'answer'; end if;
  if p_persona = 'mert' and r < 0.40 then return 'share_progress'; end if;
  if p_persona = 'ayse' and r < 0.18 then return 'invite_to_room'; end if;
  if p_persona = 'ayse' and r < 0.32 then return 'continue_previous'; end if;
  if p_persona = 'can' and p_allow_shift and r < 0.22 then return 'change_topic'; end if;
  if p_persona = 'can' and r < 0.32 then return 'joke'; end if;
  if p_persona = 'selin' and r < 0.22 then return 'share_progress'; end if;
  if p_persona = 'selin' and r < 0.32 then return 'encourage'; end if;

  r := random();
  if coalesce(p_last_body, '') <> '' and r < 0.30 then return 'answer'; end if;
  if r < 0.45 then return 'ask_question'; end if;
  if r < 0.55 then return 'share_progress'; end if;
  if p_allow_shift and r < 0.65 then return 'change_topic'; end if;
  if r < 0.75 then return 'side_comment'; end if;
  if r < 0.82 then return 'agree'; end if;
  if r < 0.88 then return 'disagree'; end if;
  if r < 0.93 then return 'joke'; end if;
  if r < 0.97 then return 'invite_to_room'; end if;
  if r < 0.99 then return 'encourage'; end if;
  return 'react';
end;
$$;

drop function if exists public.bot_compose_group_message(text, uuid, int);

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
  v_intent text := coalesce(p_intent, 'side_comment');
  v_thread text := coalesce(p_thread, 'genel');
begin
  select display_name into v_name from public.profiles where id = p_bot;
  v_persona := public.exam_chat_persona(v_name);
  v_mem := public.exam_chat_ensure_memory(p_bot, p_slug);

  if v_intent = 'share_progress' and v_mem.done <= 0 then
    v_mem.done := 4 + floor(random() * 6)::int;
  end if;
  if v_intent = 'share_progress' then
    v_mem.done := least(v_mem.goal + 5, v_mem.done + 3 + floor(random() * 5)::int);
    if v_mem.done >= v_mem.goal then
      v_mem.goal := v_mem.goal + 8;
    end if;
  end if;

  select b.body into v_line
  from public.exam_chat_line_bank b
  where (b.exam = p_slug or b.exam = '*')
    and b.intent = v_intent
    and (b.thread_key = v_thread or b.thread_key = '*')
    and (b.persona = v_persona or b.persona = '*')
    and not public.group_line_too_similar(p_slug, public.exam_chat_fill(b.body, v_mem, p_reply_name))
    and not exists (
      select 1 from unnest(v_mem.recent) s
      where left(public.exam_chat_norm(s), 18) = left(public.exam_chat_norm(b.body), 18)
    )
  order by
    (b.persona = v_persona)::int desc,
    (b.thread_key = v_thread)::int desc,
    (abs(hashtext(p_bot::text || b.body || p_attempt::text)) % 1000)
  limit 1;

  if v_line is null then
    select b.body into v_line
    from public.exam_chat_line_bank b
    where (b.exam = p_slug or b.exam = '*')
      and b.intent in ('react','agree','continue_previous','side_comment')
      and not public.group_line_too_similar(p_slug, b.body)
    order by random()
    limit 1;
  end if;

  if v_line is null then return null; end if;
  v_line := public.exam_chat_fill(v_line, v_mem, p_reply_name);
  if public.exam_chat_banned(v_line) then return null; end if;
  if public.group_line_too_similar(p_slug, v_line) then return null; end if;
  if coalesce(p_reply_body, '') <> '' and public.exam_chat_norm(v_line) = public.exam_chat_norm(p_reply_body) then
    return null;
  end if;

  v_mem.recent := (ARRAY[v_line] || coalesce(v_mem.recent, '{}'::text[]))[1:6];
  v_mem.updated_at := now();
  if v_intent = 'complain' then v_mem.mood := 'tired'; else v_mem.mood := 'normal'; end if;
  update public.exam_bot_memory
  set subject = v_mem.subject,
      topic = v_mem.topic,
      goal = v_mem.goal,
      done = v_mem.done,
      minutes_per_set = v_mem.minutes_per_set,
      mood = v_mem.mood,
      recent = v_mem.recent,
      updated_at = now()
  where bot_id = p_bot and slug = p_slug;

  return v_line;
end;
$$;

create or replace function public.exam_chat_pick_bots(p_slug text, p_n int)
returns uuid[]
language plpgsql
as $$
declare
  v uuid[];
begin
  select coalesce(array_agg(id), '{}') into v
  from (
    select pr.id
    from public.profiles pr
    where pr.is_bot
      and pr.display_name in ('Kaan','Mert','Ayşe','Can','Selin')
    order by random()
    limit greatest(2, least(4, p_n))
  ) s;
  if coalesce(array_length(v, 1), 0) < 2 then
    select coalesce(array_agg(id), v) into v
    from (
      select pr.id from public.profiles pr where pr.is_bot order by random() limit 3
    ) t;
  end if;
  return v;
end;
$$;

create or replace function public.exam_chat_touch_human(p_slug text, p_body text)
returns void
language plpgsql
as $$
declare
  v_th text;
begin
  insert into public.exam_chat_room_state (slug) values (p_slug) on conflict do nothing;
  v_th := public.exam_chat_thread_from_text(p_slug, p_body);
  update public.exam_chat_room_state
  set current_thread = coalesce(v_th, current_thread),
      last_human_at = now(),
      burst_left = greatest(burst_left, 2 + floor(random() * 2)::int),
      burst_bots = case
        when coalesce(array_length(burst_bots, 1), 0) >= 2 then burst_bots
        else public.exam_chat_pick_bots(p_slug, 3)
      end,
      next_eligible_at = least(coalesce(next_eligible_at, now() + interval '6 seconds'), now() + make_interval(secs => 4 + floor(random() * 8)::int)),
      updated_at = now()
  where slug = p_slug;
end;
$$;

create or replace function public.send_group_message(p_slug text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_last timestamptz;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_slug not in ('tyt', 'ayt', 'kpss') then raise exception 'NOT_FOUND'; end if;
  if length(trim(p_body)) < 1 then raise exception 'EMPTY_MESSAGE'; end if;
  if public.content_moderation_level(p_body) = 'block' then raise exception 'MESSAGE_BLOCKED'; end if;
  insert into public.exam_chat_members (slug, user_id) values (p_slug, v_user)
  on conflict do nothing;
  select max(created_at) into v_last from public.exam_chat_messages where slug = p_slug and sender_id = v_user;
  if v_last is not null and v_last > now() - interval '10 seconds' then
    raise exception 'SLOW_MODE';
  end if;
  insert into public.exam_chat_messages (slug, sender_id, body)
  values (p_slug, v_user, trim(p_body))
  returning id into v_id;
  perform public.exam_chat_touch_human(p_slug, p_body);
  return v_id;
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
  v_text text;
  v_try int;
  v_when timestamptz;
  v_delay int;
  v_reply uuid;
  v_name text;
  v_persona text;
  v_inferred text;
  v_age int := 0;
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
    if random() < 0.32 then
      update public.exam_chat_room_state
      set next_eligible_at = clock_timestamp() + make_interval(secs => 45 + floor(random() * 90)::int),
          updated_at = now()
      where slug = v_slug;
      return;
    end if;
    v_state.burst_bots := public.exam_chat_pick_bots(v_slug, 2 + floor(random() * 3)::int);
    v_state.burst_left := 2 + floor(random() * 3)::int;
  end if;

  select x into v_bot
  from unnest(v_state.burst_bots) as x
  where x is distinct from v_prev
  order by random()
  limit 1;
  if v_bot is null then
    select pr.id into v_bot
    from public.profiles pr
    where pr.is_bot and pr.id is distinct from v_prev
    order by random()
    limit 1;
  end if;
  if v_bot is null then return; end if;

  v_inferred := public.exam_chat_thread_from_text(v_slug, v_prev_body);
  v_thread := coalesce(v_inferred, v_state.current_thread, 'genel');
  select count(*)::int into v_age
  from (
    select 1 from public.exam_chat_messages m
    where m.slug = v_slug
    order by m.created_at desc
    limit 8
  ) q;
  v_shift := v_state.burst_left <= 2 and coalesce(v_prev_body, '') not like '%?%' and random() < 0.28;
  select display_name into v_name from public.profiles where id = v_bot;
  v_persona := public.exam_chat_persona(v_name);
  v_intent := public.exam_chat_pick_intent(v_persona, v_prev_body, v_state.burst_left, v_age, v_shift);

  if v_intent in ('change_topic', 'side_comment') and v_shift then
    v_thread := public.exam_chat_shift_thread(v_slug, v_thread);
  end if;
  if v_intent = 'invite_to_room' then
    v_thread := 'oda';
  end if;

  v_reply := null;
  if v_intent in ('answer','agree','disagree','react','continue_previous','encourage','ask_for_help') and v_prev_id is not null then
    v_reply := v_prev_id;
  end if;

  v_text := null;
  for v_try in 1..10 loop
    v_text := public.exam_chat_compose(v_slug, v_bot, v_try, v_intent, v_thread, v_prev_body, v_prev_name);
    exit when v_text is not null;
  end loop;
  if v_text is null then
    update public.exam_chat_room_state
    set burst_left = greatest(v_state.burst_left - 1, 0),
        next_eligible_at = clock_timestamp() + make_interval(secs => 20 + floor(random() * 40)::int),
        updated_at = now()
    where slug = v_slug;
    return;
  end if;

  if v_state.burst_left >= 3 then
    v_delay := 3 + floor(random() * 12)::int;
  else
    v_delay := 5 + floor(random() * 25)::int;
  end if;
  v_when := clock_timestamp() + make_interval(secs => v_delay);

  insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
  insert into public.exam_chat_messages (slug, sender_id, body, created_at, reply_to_id)
  values (v_slug, v_bot, v_text, v_when, v_reply);

  if v_state.burst_left - 1 <= 0 then
    update public.exam_chat_room_state
    set burst_left = 0,
        last_intent = v_intent,
        last_speaker = v_bot,
        current_thread = v_thread,
        next_eligible_at = v_when + make_interval(secs => 60 + floor(random() * 240)::int),
        burst_bots = '{}',
        updated_at = now()
    where slug = v_slug;
  else
    update public.exam_chat_room_state
    set burst_left = v_state.burst_left - 1,
        last_intent = v_intent,
        last_speaker = v_bot,
        current_thread = v_thread,
        burst_bots = v_state.burst_bots,
        next_eligible_at = v_when + make_interval(secs => 2 + floor(random() * 10)::int),
        updated_at = now()
    where slug = v_slug;
  end if;
end;
$$;

create or replace function public.rewrite_stale_bot_chat()
returns trigger
language plpgsql
as $$
declare
  v_new text;
  v_name text;
  v_th text;
begin
  if not exists (select 1 from public.profiles where id = new.sender_id and coalesce(is_bot, false)) then
    return new;
  end if;
  if not public.exam_chat_banned(new.body) and not public.group_line_too_similar(new.slug, new.body) then
    return new;
  end if;
  select display_name into v_name from public.profiles where id = new.sender_id;
  select current_thread into v_th from public.exam_chat_room_state where slug = new.slug;
  v_new := public.exam_chat_compose(
    new.slug, new.sender_id, 3, 'side_comment', coalesce(v_th, 'genel'), null, null
  );
  if v_new is null then return null; end if;
  new.body := v_new;
  return new;
end;
$$;

drop trigger if exists exam_chat_rewrite_stale on public.exam_chat_messages;
create trigger exam_chat_rewrite_stale
before insert on public.exam_chat_messages
for each row execute procedure public.rewrite_stale_bot_chat();

-- Stop pulse_bots from dumping the three hardcoded exam-chat templates.
create or replace function public.pulse_bots()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_bot uuid;
  v_human uuid;
  v_post uuid;
  v_body text;
  v_sub uuid;
  v_tag text;
  v_kind text;
  v_mins int;
  v_prompt text;
  v_session uuid;
  v_qid uuid;
  v_correct text;
  v_pick text;
  v_sess public.study_sessions%rowtype;
  v_budget int;
  v_placed int := 0;
  v_intent text;
  v_used text[] := '{}';
  v_text text;
  v_try int;
  v_delay int;
  v_name text;
  v_bio text;
  v_roll float;
  v_parent uuid;
  v_bots_on_post int;
begin
  select last_pulse_at into v_last from public.bot_clock where id = 1;
  if v_last is not null and v_last > now() - interval '90 seconds' then
    return;
  end if;
  update public.bot_clock set last_pulse_at = now() where id = 1;

  if random() < 0.38 then
    select id, display_name, coalesce(bio, '') into v_bot, v_name, v_bio
    from public.profiles where is_bot order by random() limit 1;
    if v_bot is not null then
      v_mins := (array[30, 60, 120, 240])[1 + floor(random() * 4)::int];
      v_prompt := case
        when v_bio ilike '%matematik%' or v_name = 'Elif' then (array['Polinom setine bakıyorum.','Bugün mat netini yokluyorum.','Temel set açık bende.'])[1 + floor(random()*3)::int]
        when v_bio ilike '%tarih%' or v_name = 'Mert' then (array['Tarih tekrarındayım.','Osmanlı kronolojisi açık.','Tarihte neredesiniz?'])[1 + floor(random()*3)::int]
        when v_bio ilike '%coğrafya%' or v_name = 'Ayşe' then (array['Coğrafya çalışacak var mı?','Harita başındayım.','İklim sorularına bakıyorum.'])[1 + floor(random()*3)::int]
        when v_bio ilike '%paragraf%' or v_name = 'Can' then (array['Paragraf seti çözüyorum.','Türkçe 15 soru hedefim.','Anlam bilgisi tarıyorum.'])[1 + floor(random()*3)::int]
        when v_bio ilike '%fizik%' or v_name = 'Zeynep' then (array['AYT fizik testine bakıyorum.','Optik biraz ağır bugün.','Fizikte 12 soru.'])[1 + floor(random()*3)::int]
        when v_name = 'Emre' then (array['Vatandaşlık tekrar.','KPSS günü, kısa set.','Anayasa maddeleri.'])[1 + floor(random()*3)::int]
        when v_name = 'Defne' then (array['Kimya formülleri açık.','Mol hesabı çalışıyorum.','Kimyada 10 soru.'])[1 + floor(random()*3)::int]
        when v_name = 'Kaan' then (array['Geometri çiziyorum.','Üçgen benzerliği.','Geometride 8 soru kaldı.'])[1 + floor(random()*3)::int]
        when v_name = 'Selin' then (array['Edebiyat notları.','Şiir bilgisi tarıyorum.','Türkçe edebiyat tekrar.'])[1 + floor(random()*3)::int]
        else (array['Deneme analizi yapıyorum.','Bugünkü hedef 40 soru.','Kısa mola, sonra devam.'])[1 + floor(random()*3)::int]
      end;
      select s.id into v_sub
      from public.subjects s
      where s.name ilike '%' || public.infer_post_topic(v_prompt, null) || '%'
      order by random()
      limit 1;
      if v_sub is null then
        select s.id into v_sub from public.subjects s order by random() limit 1;
      end if;
      insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at)
      values (v_bot, v_prompt, 'status', v_sub, v_mins, now() + make_interval(mins => v_mins));
    end if;
  end if;

  if random() < 0.28 then
    v_budget := 0;
  elsif random() < 0.62 then
    v_budget := 2;
  else
    v_budget := 3;
  end if;

  for v_post, v_body, v_human, v_kind, v_tag in
    select p.id, p.body, p.user_id, p.kind, coalesce(sub.name, '')
    from public.social_posts p
    left join public.subjects sub on sub.id = p.subject_id
    where (p.expires_at is null or p.expires_at > now())
      and p.kind in ('status', 'ask', 'activity')
      and p.created_at < now() - interval '50 seconds'
    order by p.created_at desc
    limit 8
  loop
    exit when v_placed >= v_budget;
    if random() < 0.34 then
      continue;
    end if;

    select count(*) into v_bots_on_post
    from public.post_comments c
    join public.profiles b on b.id = c.user_id and b.is_bot
    where c.post_id = v_post;
    if v_bots_on_post >= 2 then
      continue;
    end if;

    v_used := '{}';
    for v_bot in
      select pr.id
      from public.profiles pr
      where pr.is_bot
        and pr.id <> v_human
        and not exists (select 1 from public.post_comments c where c.post_id = v_post and c.user_id = pr.id)
        and not exists (
          select 1 from public.post_comments c
          where c.user_id = pr.id and c.created_at > now() - interval '3 minutes'
        )
      order by random()
      limit 2
    loop
      exit when v_placed >= v_budget;
      v_roll := random();
      if v_roll < 0.3 then
        continue;
      end if;
      insert into public.post_likes (post_id, user_id) values (v_post, v_bot) on conflict do nothing;
      if v_roll < 0.62 then
        continue;
      end if;

      v_intent := (array['join','encourage','progress','advice','question'])[1 + floor(random() * 5)::int];
      if v_intent = any(v_used) then
        v_intent := 'encourage';
      end if;
      if v_intent = 'question' and 'question' = any(v_used) then
        v_intent := 'advice';
      end if;
      v_used := v_used || v_intent;

      v_text := null;
      for v_try in 1..6 loop
        v_text := public.bot_compose_comment(v_post, v_bot, v_intent, v_try);
        exit when v_text is not null and not public.comment_too_similar(v_post, v_text);
        v_text := null;
      end loop;
      if v_text is null then
        continue;
      end if;

      v_parent := null;
      if random() < 0.45 then
        select c.id into v_parent
        from public.post_comments c
        join public.profiles a on a.id = c.user_id
        where c.post_id = v_post and c.parent_id is null and not a.is_bot and c.created_at <= now()
        order by c.created_at desc
        limit 1;
      end if;

      v_delay := 8 + v_placed * 20 + floor(random() * 16)::int;
      begin
        insert into public.post_comments (post_id, user_id, body, parent_id, created_at)
        values (v_post, v_bot, v_text, v_parent, now() + make_interval(secs => v_delay));
        v_placed := v_placed + 1;
      exception when unique_violation then
        null;
      end;
      exit;
    end loop;
  end loop;

  select s.id into v_session
  from public.study_sessions s
  where s.mode = 'exam' and s.status = 'waiting'
    and (select count(*) from public.study_session_members m where m.session_id = s.id) < s.capacity
  order by random() limit 1;
  if v_session is not null then
    select id into v_bot from public.profiles where is_bot
      and not exists (select 1 from public.study_session_members m where m.session_id = v_session and m.user_id = profiles.id)
    order by random() limit 1;
    if v_bot is not null then
      insert into public.study_session_members (session_id, user_id) values (v_session, v_bot) on conflict do nothing;
    end if;
  end if;

  for v_sess in
    select * from public.study_sessions where mode in ('race', 'exam') and status = 'active'
  loop
    perform public.maybe_activate_session(v_sess.id);
    v_qid := v_sess.question_ids[v_sess.current_index + 1];
    if v_qid is null then continue; end if;
    select correct_choice into v_correct from public.questions where id = v_qid;
    for v_bot in
      select m.user_id from public.study_session_members m
      join public.profiles p on p.id = m.user_id
      where m.session_id = v_sess.id and p.is_bot
        and not exists (
          select 1 from public.study_session_answers a
          where a.session_id = v_sess.id and a.question_id = v_qid and a.user_id = m.user_id
        )
    loop
      if public.bot_should_miss(v_sess.id, v_bot, v_sess.current_index, coalesce(array_length(v_sess.question_ids, 1), 10)) then
        if random() < 0.45 then continue; end if;
        v_pick := case upper(coalesce(v_correct, 'A'))
          when 'A' then 'C' when 'B' then 'D' when 'C' then 'A' when 'D' then 'B' else 'A' end;
      else
        v_pick := upper(coalesce(v_correct, 'A'));
      end if;
      insert into public.study_session_answers (session_id, question_id, user_id, selected_choice, is_correct)
      values (v_sess.id, v_qid, v_bot, v_pick, upper(v_pick) = upper(coalesce(v_correct, '')))
      on conflict do nothing;
    end loop;
    perform public.advance_competitive(v_sess.id);
  end loop;
end;
$$;

revoke all on function public.pulse_exam_chats() from public;
grant execute on function public.pulse_exam_chats() to authenticated;
grant execute on function public.send_group_message(text, text) to authenticated;
