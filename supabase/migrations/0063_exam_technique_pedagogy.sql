-- Phase 3H: exam-technique-first pedagogy. Schema, scoring, 8 pattern seeds. Engine stays paused. No mass generation.

alter table public.memory_lessons
  add column if not exists minimum_theory text,
  add column if not exists fast_rule text,
  add column if not exists exam_technique jsonb not null default '{}'::jsonb,
  add column if not exists technique_score integer,
  add column if not exists academic_pass boolean;

alter table public.memory_lesson_questions
  add column if not exists technique_role text,
  add column if not exists trap_type text;

alter table public.questions
  add column if not exists question_pattern_id uuid,
  add column if not exists recommended_strategy text,
  add column if not exists trap_type text,
  add column if not exists technique_role text;

create table if not exists public.exam_question_patterns (
  id uuid primary key default gen_random_uuid(),
  canonical_topic_id uuid references public.canonical_topics(id) on delete cascade,
  exam_id uuid references public.exam_catalog(id) on delete set null,
  name text not null,
  recognition_trigger text not null,
  fast_strategy text not null,
  common_traps text,
  elimination_rules text,
  when_not_to_use text,
  example_signals jsonb not null default '[]'::jsonb,
  first_move text,
  fast_rule text,
  heuristic_kind text not null default 'strong_clue',
  verification_step text,
  memory_hook text,
  minimum_theory text,
  priority int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_question_patterns_heuristic_check
    check (heuristic_kind in ('rule', 'strong_clue', 'shortcut', 'mnemonic'))
);

drop index if exists public.exam_question_patterns_topic_name_uidx;

create index if not exists exam_question_patterns_topic_idx
  on public.exam_question_patterns (canonical_topic_id, priority);

alter table public.questions
  drop constraint if exists questions_question_pattern_fk;
alter table public.questions
  add constraint questions_question_pattern_fk
  foreign key (question_pattern_id) references public.exam_question_patterns(id) on delete set null;

alter table public.exam_question_patterns enable row level security;

drop policy if exists exam_question_patterns_admin on public.exam_question_patterns;
create policy exam_question_patterns_admin on public.exam_question_patterns
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists exam_question_patterns_read on public.exam_question_patterns;
create policy exam_question_patterns_read on public.exam_question_patterns
  for select to authenticated using (true);

grant select on public.exam_question_patterns to authenticated;
grant insert, update, delete on public.exam_question_patterns to authenticated;

do $$
begin
  alter table public.memory_lesson_questions drop constraint if exists memory_lesson_questions_strategy_check;
  alter table public.memory_lesson_questions
    add constraint memory_lesson_questions_strategy_check
    check (
      question_strategy is null
      or question_strategy in (
        'direct_recall', 'visual_recall', 'contrast_recall', 'sequence_recall', 'application',
        'pattern_recognition', 'first_move', 'elimination', 'exam_style',
        'cause_effect', 'interpretation'
      )
    );
  alter table public.questions drop constraint if exists questions_strategy_check;
  alter table public.questions
    add constraint questions_strategy_check
    check (
      question_strategy is null
      or question_strategy in (
        'direct_recall', 'visual_recall', 'contrast_recall', 'sequence_recall',
        'application', 'cause_effect', 'interpretation',
        'pattern_recognition', 'first_move', 'elimination', 'exam_style'
      )
    );
exception when others then
  null;
end $$;

insert into public.ai_model_config (
  task_type, provider, primary_model, fallback_model, economy_model, premium_model,
  quality_tier, minimum_quality_tier, max_output_tokens, temperature,
  estimated_cost_class, notes
) values
  ('exam_technique_validation', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 2500, 0.1, 'high', 'Sınav tekniği doğrulama')
on conflict (task_type) do nothing;

create or replace function public.seed_exam_question_pattern(
  p_topic_name text,
  p_name text,
  p_recognition text,
  p_first_move text,
  p_fast text,
  p_traps text,
  p_elim text,
  p_when_not text,
  p_signals text[],
  p_fast_rule text,
  p_kind text,
  p_verify text,
  p_hook text,
  p_theory text,
  p_priority int
)
returns void
language plpgsql
as $$
declare
  v_topic uuid;
begin
  select id into v_topic
  from public.canonical_topics
  where lower(name) = lower(p_topic_name)
     or master_key like '%|' || public.catalog_slug_from_name(p_topic_name)
  order by case when lower(name) = lower(p_topic_name) then 0 else 1 end
  limit 1;
  if v_topic is null then
    return;
  end if;
  insert into public.exam_question_patterns (
    canonical_topic_id, name, recognition_trigger, first_move, fast_strategy, common_traps,
    elimination_rules, when_not_to_use, example_signals, fast_rule, heuristic_kind,
    verification_step, memory_hook, minimum_theory, priority
  ) values (
    v_topic, p_name, p_recognition, p_first_move, p_fast, p_traps, p_elim, p_when_not,
    to_jsonb(p_signals), p_fast_rule, p_kind, p_verify, p_hook, p_theory, p_priority
  )
  on conflict (canonical_topic_id, name) do update set
    recognition_trigger = excluded.recognition_trigger,
    first_move = excluded.first_move,
    fast_strategy = excluded.fast_strategy,
    common_traps = excluded.common_traps,
    elimination_rules = excluded.elimination_rules,
    when_not_to_use = excluded.when_not_to_use,
    example_signals = excluded.example_signals,
    fast_rule = excluded.fast_rule,
    heuristic_kind = excluded.heuristic_kind,
    verification_step = excluded.verification_step,
    memory_hook = excluded.memory_hook,
    minimum_theory = excluded.minimum_theory,
    priority = excluded.priority,
    updated_at = now();
end;
$$;

-- Unique conflict requires unique constraint; partial unique index may not work with ON CONFLICT.
-- Add a dedicated unique constraint on (canonical_topic_id, name) for non-null topics.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_question_patterns_topic_name_key') then
    alter table public.exam_question_patterns
      add constraint exam_question_patterns_topic_name_key unique (canonical_topic_id, name);
  end if;
exception when others then
  null;
end $$;

select public.seed_exam_question_pattern(
  'Paragrafta Yapı',
  'Cümle sıralama / giriş cümlesi',
  'Soru hangi cümlenin başa, ikinci sıraya, önce veya sonra geleceğini sorar.',
  'Cümle başlarındaki bağlaç ve göndermeleri tara; bağlama bağımlı adayları ele.',
  'Bağımsız giriş adayı seç, sonra anlamla doğrula. Tüm metni iki kez okumak ilk hamle değildir.',
  'Akılda kalan ayrıntılı cümleyi giriş sanmak; bağlacı kesin kural gibi kullanmak.',
  'bu / bunlar / böyle / ancak / çünkü / dolayısıyla ile başlayanları önce ele.',
  'Bağımsız görünen iki aday kalırsa anlam bütünlüğü olmadan seçme.',
  array['bu parçanın başına','ikinci cümlesi','hangisi getirilebilir','anlam akışını bozan'],
  'Bağlaçla başlayan cümle çoğu zaman giriş değildir. Önce bağımsız başlayanı ara, sonra anlamla doğrula.',
  'strong_clue',
  'Adayı paragraf anlamına karşı doğrula.',
  'Kapı tokmağı: bağlaç = önce biri konuşmuş.',
  'Giriş cümlesi genelde önceki bağlama ihtiyaç duymaz.',
  10
);

select public.seed_exam_question_pattern(
  'Paragrafta Anlam',
  'Ana fikir / başlık',
  'Paragrafın bütününü veya başlığını sorar; bir cümle tekrarı yetmez.',
  'Seçeneklerin tüm paragrafı kapsayıp kapsamadığına bak; tek cümle ayrıntısını ele.',
  'Bütünü örten seçenek. Akılda kalan ayrıntı tuzaktır.',
  'Bir cümleyi tekrarlayan ama parçanın tamamını kapsamayan şık.',
  'Kısmi doğru ve aşırı genel başlıkları ele.',
  'Soru destekleyici ayrıntı istiyorsa ana fikir tekniğini kullanma.',
  array['ana düşünce','başlık','asıl anlatılmak istenen'],
  'Akılda kalan ayrıntı değil, tüm paragrafı örten şık.',
  'strong_clue',
  'Seçeneği her cümleye karşı sına.',
  'Şemsiye: başlık tüm yağmuru örter.',
  'Ana fikir parçanın tamamını kapsar.',
  20
);

select public.seed_exam_question_pattern(
  'Problemler',
  'Yüzde artış-azalış',
  'Kökte yüzde, zam, indirim, kâr veya oran artışı geçer.',
  'Başlangıcı 100 al veya çarpan yaz.',
  '%20 artış ×1,20; %20 azalış ×0,80. Aynı oran zam-indirim başlangıca dönmez (100→120→96).',
  'Zam ve indirimin birbirini götürdüğünü sanmak.',
  'Şıktan deneme yalnızca modelden gerçekten hızlıysa; orta değer, basamak, işaret.',
  'Bileşik basamak belirsizse kör çarpan uygulama.',
  array['yüzde','zam','indirim','en az','en çok','oran'],
  'Zam ve indirim aynı oran olsa bile başlangıca dönmez.',
  'rule',
  'Çarpanı bir örnek sayıyla doğrula.',
  '100 altın → 120 → 96.',
  '%20 artış ×1,20; %20 azalış ×0,80.',
  10
);

select public.seed_exam_question_pattern(
  'İslamiyet Öncesi Türk Tarihi',
  'Kut / Töre / Kurultay',
  'Kökte kutsal meşruiyet, hanedan, taht kavgaları, töre veya kurultay geçer.',
  'Anahtar kelimeyi kavrama bağla; karıştırılan çifti kontrastla.',
  'Kut zinciri: kutsal yetki → hanedan → veraset belirsizliği → taht kavgaları.',
  'Kut ile Töre, Kurultay ile Divan eşitlemesi.',
  'Komşu kavram şıklarını ele; dönem dışı kurumu çıkar.',
  'Osmanlı divan teşkilatı soruluyorsa Göktürk kurultayına çekme.',
  array['kut','töre','kurultay','ilahi','veraset'],
  'Kut = tanrısal yetki. Töre = kural. Kurultay = meclis.',
  'mnemonic',
  'Karşıt kart: Kut≠Töre, Kurultay≠Divan.',
  'Altın taç = Kut.',
  'Kut tanrısal yönetme yetkisi; Töre hukuk-gelenek; Kurultay meclis.',
  10
);

select public.seed_exam_question_pattern(
  'İlk Türk Devletleri',
  'Kut / Töre / Kurultay',
  'Kökte kutsal meşruiyet, hanedan, taht kavgaları, töre veya kurultay geçer.',
  'Anahtar kelimeyi kavrama bağla; karıştırılan çifti kontrastla.',
  'Kut zinciri: kutsal yetki → hanedan → veraset belirsizliği → taht kavgaları.',
  'Kut ile Töre, Kurultay ile Divan eşitlemesi.',
  'Komşu kavram şıklarını ele.',
  'Osmanlı divanı soruluyorsa bu zinciri yapıştırma.',
  array['kut','töre','kurultay'],
  'Kut = tanrısal yetki. Töre = kural. Kurultay = meclis.',
  'mnemonic',
  'Karşıt kart doğrula.',
  'Altın taç = Kut.',
  'Kut tanrısal yönetme yetkisi.',
  10
);

select public.seed_exam_question_pattern(
  'Türkiye''nin Yer Şekilleri',
  'Dağ uzanışı sonucu',
  'Harita veya kökte dağların kıyıya paralel/dik uzanışı, kıyı-iç farkı sorulur.',
  'Haritada bölge, yön, yükselti, kıyı doğrultusunu oku.',
  'Paralel uzanış → ulaşım zor, nem içeri az, bölgesel zıtlık artar.',
  'Enine uzanışı boyuna okumak.',
  'Harita ipucu metinden güçlüyse uzun metni ertele.',
  'Dağlar kıyıya dikse paralel sonuç zincirini tersine çevir.',
  array['paralel','kıyı','ulaşım','iklim'],
  'Kıyıya paralel dağ: ulaşım zor, iklim içeri zor girer, zıtlık artar.',
  'strong_clue',
  'Uzanış yönünü haritadan doğrula.',
  'Duvar gibi dağ: deniz içeri giremez.',
  'Kıyıya paralel dağlar kıyı-iç bağlantısını zorlaştırır.',
  10
);

select public.seed_exam_question_pattern(
  'Yer Şekilleri',
  'Dağ uzanışı sonucu',
  'Harita veya kökte dağların kıyıya paralel/dik uzanışı, kıyı-iç farkı sorulur.',
  'Haritada bölge, yön, yükselti, kıyı doğrultusunu oku.',
  'Paralel uzanış → ulaşım zor, nem içeri az, bölgesel zıtlık artar.',
  'Enine uzanışı boyuna okumak.',
  'Harita ipucu metinden güçlüyse uzun metni ertele.',
  'Dağlar kıyıya dikse paralel sonuç zincirini tersine çevir.',
  array['paralel','kıyı','ulaşım','iklim'],
  'Kıyıya paralel dağ: ulaşım zor, iklim içeri zor girer, zıtlık artar.',
  'strong_clue',
  'Uzanış yönünü haritadan doğrula.',
  'Duvar gibi dağ: deniz içeri giremez.',
  'Kıyıya paralel dağlar kıyı-iç bağlantısını zorlaştırır.',
  10
);

select public.seed_exam_question_pattern(
  'Yargı',
  'Kurum-yetki eşlemesi',
  'Hangi kurumun hangi işlemi yaptığı veya hangisinin bakamayacağı sorulur.',
  'Kurum → yetki → işlem türü ızgarasını aç.',
  'Önce işlem türü (kanun / anayasa denetimi / idari uyuşmazlık), sonra kurum.',
  'Yargıyı yürütmeyle karıştırmak; eski anayasa kuralını güncel sanmak.',
  'İşlem türü uymayan kurumları hemen ele.',
  'Tarihî anayasa dönemi soruluyorsa 1982 ızgarasını yapıştırma.',
  array['TBMM','Anayasa Mahkemesi','idari yargı','kanun'],
  'Önce işlem türü, sonra kurum. Kanun=TBMM, anayasa denetimi=AYM.',
  'rule',
  'Güncel yetkiyi teyit et.',
  'Üç kapı: yasama / yürütme / yargı.',
  'TBMM kanun, AYM anayasa denetimi, idari yargı idari uyuşmazlık.',
  10
);

select public.seed_exam_question_pattern(
  'Hareket',
  'x-t / v-t grafik',
  'Grafikte konum-zaman veya hız-zaman; eğim veya alan sorulur.',
  'Eksenleri oku. Uzun hikâyeden önce grafiğe bak.',
  'x-t eğim=hız. v-t alan=yer değiştirme, eğim=ivme.',
  'x-t eğimini ivme sanmak; alanı hız sanmak.',
  'Yanlış eksen yorumunu ele.',
  'Eksenler ivme-zaman ise x-t kurallarını taşıma.',
  array['grafik','eğim','alan','ivme'],
  'Önce eksen. x-t eğim=hız. v-t alan=yer değiştirme, eğim=ivme.',
  'rule',
  'Eksen birimlerini doğrula.',
  'Merdiven eğimi=hız; boyanan alan=yol.',
  'Grafik eksenleri formül seçiminden önce gelir.',
  10
);

select public.seed_exam_question_pattern(
  'Atom ve Periyodik Sistem',
  'Periyodik eğilim',
  'Yarıçap, iyonlaşma enerjisi veya elektronegatiflik karşılaştırması.',
  'Periyodik yön haritasını çiz; istisna var mı bak.',
  'Yarıçap sola-aşağı büyür. Elektronegatiflik ve iyonlaşma genelde sağa-yukarı artar.',
  'Eğilimi istisnasız kural sanmak (Be/B, N/O).',
  'Konumdan genel yönü al, istisna şıklarını ayrıca ele.',
  'Geçiş metalleri veya yarı dolu orbital istisnasında ezber oku kullanma.',
  array['periyodik','yarıçap','iyonlaşma','elektronegatiflik'],
  'Yarıçap sola-aşağı büyür. Elektronegatiflik sağa-yukarı artar. İstisnayı ayrı kontrol et.',
  'strong_clue',
  'İstisna çiftini kontrol et.',
  'Oklar: yarıçap şişer sola-aşağı.',
  'Genel eğilim + istisna ayrı öğretilir.',
  10
);

select public.seed_exam_question_pattern(
  'Hücre Organelleri',
  'Organel işlev anahtarı',
  'İşlev veya ''hangisi ... yapar'' kökü.',
  'İşlev anahtar kelimesini organele bağla.',
  'Ribozom=protein, mitokondri=ATP, Golgi=paket, lizozom=sindirim.',
  'Golgi/ER ve mitokondri/kloroplast karışıklığı.',
  'İşlevi tutmayan organeli ele.',
  'Bitki özgü plastid sorusunda hayvan hücresi kartını yapıştırma.',
  array['ribozom','mitokondri','golgi','lizozom'],
  'Ribozom protein, mitokondri ATP, Golgi kargo, lizozom çöp öğütücü.',
  'mnemonic',
  'İşlevi cümlede doğrula.',
  'Fabrika: tezgahtar ribozom, santral mitokondri.',
  'Organel → işlev anahtar kelimesi.',
  10
);

-- Extra Turkish library rows on related topics when present
select public.seed_exam_question_pattern(
  'Paragrafta Yapı',
  'Cümle yerleştirme',
  'Numaralı cümleler arasına hangisi getirilir sorusu.',
  'Boşluğun öncesi-sonrası bağını oku; seçeneğin her iki yana uyumunu sına.',
  'Önce bağlaç/gönderim, sonra konu sürekliliği.',
  'Yalnızca önceki cümleye uyan ama sonrakini bozan şık.',
  'Tek yöne uyanları ele.',
  'Akış bozma sorusunda yerleştirme tekniğini ters kullan.',
  array['hangisi getirilebilir','arasına'],
  'Boşluğun iki yanına bak. Tek yöne uyan şık tuzaktır.',
  'strong_clue',
  'Seçeneği önceki ve sonraki cümleyle oku.',
  null,
  'Yerleştirilen cümle her iki komşuya da bağlanmalı.',
  30
);

create or replace function public.memory_lesson_pedagogy_report(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lesson public.memory_lessons;
  v_scenes int := 0;
  v_anchored int := 0;
  v_facts int := 0;
  v_facts_hooked int := 0;
  v_checkpoints int := 0;
  v_finals int := 0;
  v_strategies int := 0;
  v_tech_moves int := 0;
  v_tech jsonb := '{}'::jsonb;
  v_score int := 0;
  v_academic int := 0;
  v_memory int := 0;
  v_pattern int := 0;
  v_solve int := 0;
  v_trap int := 0;
  v_brief int := 0;
  v_issues jsonb := '[]'::jsonb;
  v_blocking boolean := false;
  v_academic_ok boolean := true;
  v_aaa boolean := false;
  v_kind text;
begin
  select * into v_lesson from public.memory_lessons where id = p_id;
  if v_lesson.id is null then
    return jsonb_build_object('ok', false, 'score', 0, 'blocking', true, 'issues', jsonb_build_array('Ders bulunamadı.'));
  end if;

  v_tech := coalesce(v_lesson.exam_technique, '{}'::jsonb);
  select count(*) into v_scenes from public.memory_lesson_scenes where lesson_id = p_id;
  select count(*) into v_anchored
  from public.memory_lesson_scenes
  where lesson_id = p_id and nullif(trim(visual_anchor), '') is not null;
  v_facts := coalesce(jsonb_array_length(v_lesson.core_facts), 0);
  select count(*) into v_facts_hooked
  from jsonb_array_elements(coalesce(v_lesson.core_facts, '[]'::jsonb)) f
  where nullif(trim(coalesce(f->>'visual_anchor', f->>'memory_hook', '')), '') is not null
     or nullif(trim(coalesce(f->>'exception', '')), '') is not null;
  select count(*) into v_checkpoints
  from public.memory_lesson_questions
  where lesson_id = p_id and question_type = 'checkpoint';
  select count(*) into v_finals
  from public.memory_lesson_questions
  where lesson_id = p_id and question_type = 'final';
  select count(distinct question_strategy) into v_strategies
  from public.memory_lesson_questions
  where lesson_id = p_id and question_type = 'final' and question_strategy is not null;
  select count(*) into v_tech_moves
  from public.memory_lesson_questions
  where lesson_id = p_id and question_type = 'checkpoint'
    and question_strategy in ('first_move', 'pattern_recognition', 'elimination');

  if v_facts < 5 then
    v_issues := v_issues || jsonb_build_array('5–12 çekirdek olgu tanımlanmalı.');
    v_academic_ok := false;
  end if;
  if v_facts > 0 and v_facts_hooked < v_facts then
    v_issues := v_issues || jsonb_build_array('Her çekirdek olgunun hafıza kancası veya gerekçeli istisnası olmalı.');
  end if;
  if nullif(trim(coalesce(v_lesson.minimum_theory, '')), '') is null then
    v_issues := v_issues || jsonb_build_array('Asgari teori (KNOW) eksik.');
    v_academic_ok := false;
  end if;
  if nullif(trim(coalesce(v_tech->>'recognition_trigger', '')), '') is null then
    v_issues := v_issues || jsonb_build_array('Tanıma tetikleyicisi eksik; ders yalnızca anlatım.');
  end if;
  if nullif(trim(coalesce(v_tech->>'fast_strategy', v_lesson.fast_rule, '')), '') is null then
    v_issues := v_issues || jsonb_build_array('Hızlı çözüm yolu yok.');
  end if;
  if nullif(trim(coalesce(v_tech->>'when_not_to_use', '')), '') is null then
    v_issues := v_issues || jsonb_build_array('Tekniğin sınırı (when_not_to_use) yazılmalı.');
  end if;
  if nullif(trim(coalesce(v_lesson.fast_rule, '')), '') is null then
    v_issues := v_issues || jsonb_build_array('5 saniyelik kural (fast_rule) eksik.');
  end if;
  if coalesce(v_lesson.duration_sec, 0) > 300 and v_checkpoints < 2 then
    v_issues := v_issues || jsonb_build_array('5 dakikayı aşan derslerde en az 2 hatırlatma kontrolü gerekli.');
  end if;
  if v_checkpoints < 1 then
    v_issues := v_issues || jsonb_build_array('En az bir hatırlatma kontrolü gerekli.');
  end if;
  if v_tech_moves < 1 and v_checkpoints > 0 then
    v_issues := v_issues || jsonb_build_array('Checkpoint yalnızca tanım olmamalı; ilk hamle sorusu gerekli.');
  end if;
  if v_finals < 10 then
    v_issues := v_issues || jsonb_build_array('Final testinde 10 soru olmalı.');
  end if;
  if v_scenes > 0 and v_anchored < greatest(v_scenes - 1, 1) then
    v_issues := v_issues || jsonb_build_array('Sahnelerin görsel çıpaları eksik.');
  end if;
  if v_finals >= 10 and v_strategies < 3 then
    v_issues := v_issues || jsonb_build_array('Final soruları bilgi + kalıp + teknik karışımı olmalı.');
  end if;
  v_kind := coalesce(v_tech->>'heuristic_kind', '');
  if v_kind = 'rule' and position('her zaman' in lower(coalesce(v_tech->>'fast_strategy', ''))) > 0 then
    v_issues := v_issues || jsonb_build_array('Sezgi mutlak kural gibi yazılmış olabilir.');
  end if;
  v_aaa := coalesce((v_tech->>'aaa_bu_suydu')::boolean, false);
  if not v_aaa and nullif(trim(coalesce(v_tech->>'recognition_trigger', '')), '') is not null then
    v_issues := v_issues || jsonb_build_array('"Aaa bu şuydu" testi geçmedi; kalıp çok genel.');
  end if;

  if nullif(trim(coalesce(v_lesson.minimum_theory, '')), '') is not null and v_facts between 5 and 12 then
    v_academic := 25;
  elsif nullif(trim(coalesce(v_lesson.minimum_theory, '')), '') is not null then
    v_academic := 12;
  end if;
  if v_lesson.primary_memory_technique is not null and v_anchored >= greatest(v_scenes - 1, 1) then
    v_memory := 20;
  elsif v_lesson.primary_memory_technique is not null or v_anchored > 0 then
    v_memory := 10;
  end if;
  if nullif(trim(coalesce(v_tech->>'recognition_trigger', '')), '') is not null
     and nullif(trim(coalesce(v_tech->>'recognize', v_tech->>'first_move', '')), '') is not null then
    v_pattern := 20;
  elsif nullif(trim(coalesce(v_tech->>'recognition_trigger', '')), '') is not null then
    v_pattern := 10;
  end if;
  if nullif(trim(coalesce(v_tech->>'fast_strategy', '')), '') is not null
     and nullif(trim(coalesce(v_lesson.fast_rule, '')), '') is not null then
    v_solve := 20;
  elsif nullif(trim(coalesce(v_tech->>'fast_strategy', v_lesson.fast_rule, '')), '') is not null then
    v_solve := 10;
  end if;
  if nullif(trim(coalesce(v_tech->>'common_traps', '')), '') is not null
     and nullif(trim(coalesce(v_tech->>'when_not_to_use', '')), '') is not null then
    v_trap := 10;
  elsif nullif(trim(coalesce(v_tech->>'common_traps', '')), '') is not null then
    v_trap := 5;
  end if;
  if char_length(trim(coalesce(v_lesson.fast_rule, ''))) between 8 and 280 then
    v_brief := 5;
  elsif char_length(trim(coalesce(v_lesson.fast_rule, ''))) > 0 then
    v_brief := 2;
  end if;

  v_score := least(100, v_academic + v_memory + v_pattern + v_solve + v_trap + v_brief);
  v_blocking := (not v_academic_ok) or jsonb_array_length(v_issues) > 0 or v_score < 80;

  return jsonb_build_object(
    'ok', not v_blocking,
    'score', v_score,
    'technique_score', v_pattern + v_solve + v_trap,
    'academic_pass', v_academic_ok,
    'blocking', v_blocking,
    'issues', v_issues,
    'parts', jsonb_build_object(
      'academic', v_academic,
      'memory', v_memory,
      'pattern', v_pattern,
      'technique', v_solve,
      'traps', v_trap,
      'brevity', v_brief
    )
  );
end;
$$;

create or replace function public.refresh_memory_lesson_pedagogy(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report jsonb;
  v_scene record;
  v_n int := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'ADMIN_ONLY';
  end if;
  v_report := public.memory_lesson_pedagogy_report(p_id);

  delete from public.memory_lesson_review_anchors where lesson_id = p_id;
  for v_scene in
    select id, visual_anchor, memory_target, recall_prompt, memory_technique, scene_order
    from public.memory_lesson_scenes
    where lesson_id = p_id
      and nullif(trim(visual_anchor), '') is not null
    order by scene_order
  loop
    v_n := v_n + 1;
    insert into public.memory_lesson_review_anchors (
      lesson_id, scene_id, code, memory_target, visual_anchor, recall_prompt, memory_technique, sort_order
    )
    values (
      p_id,
      v_scene.id,
      'anchor-' || lpad(v_n::text, 3, '0'),
      coalesce(nullif(trim(v_scene.memory_target), ''), 'olgu'),
      trim(v_scene.visual_anchor),
      v_scene.recall_prompt,
      v_scene.memory_technique,
      v_n
    );
  end loop;

  update public.memory_lessons
  set
    pedagogy_score = (v_report->>'score')::int,
    pedagogy_issues = coalesce(v_report->'issues', '[]'::jsonb),
    technique_score = (v_report->>'technique_score')::int,
    academic_pass = coalesce((v_report->>'academic_pass')::boolean, false),
    pedagogy_version = coalesce(pedagogy_version, 'exam-technique-v1')
  where id = p_id;

  return v_report;
end;
$$;

create or replace function public.diagnose_tagged_attempts(p_question_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_lines jsonb := '[]'::jsonb;
  v_median numeric;
  v_set_avg numeric;
  v_tagged int := 0;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_question_ids is null or array_length(p_question_ids, 1) is null then
    return jsonb_build_object('lines', '[]'::jsonb, 'speed', null, 'has_tags', false);
  end if;

  select percentile_cont(0.5) within group (order by time_spent_ms)
    into v_median
  from public.question_attempts
  where user_id = v_user and time_spent_ms is not null and time_spent_ms > 0;

  select avg(a.time_spent_ms), count(*) filter (where q.question_strategy is not null or q.trap_type is not null)
    into v_set_avg, v_tagged
  from public.question_attempts a
  join public.questions q on q.id = a.question_id
  where a.user_id = v_user
    and a.question_id = any (p_question_ids)
    and a.created_at > now() - interval '2 hours';

  select coalesce(jsonb_agg(x.line order by x.wrong desc), '[]'::jsonb)
    into v_lines
  from (
    select
      count(*) filter (where not a.is_correct) as wrong,
      case
        when count(*) filter (where not a.is_correct) = 0 then null
        when q.question_strategy in ('pattern_recognition', 'first_move') then
          'Kalıbı tanıyorsun ama ilk hamleyi uygulamadan fazla okuyor veya hesaplıyorsun olabilir.'
        when q.question_strategy in ('application', 'elimination', 'exam_style') then
          coalesce(q.recommended_strategy, 'Teknik uygulama sorularında modeli kurmakta zorlanıyorsun.')
        when q.trap_type is not null then
          'Tuzak türü: ' || q.trap_type || '. Bilgi var, eleme kuralı kaçmış olabilir.'
        when q.question_strategy = 'direct_recall' then
          'Doğrudan bilgi eksik; teknik değil hatırlama.'
        else null
      end as line
    from public.question_attempts a
    join public.questions q on q.id = a.question_id
    where a.user_id = v_user
      and a.question_id = any (p_question_ids)
      and a.created_at > now() - interval '2 hours'
    group by q.question_strategy, q.trap_type, q.recommended_strategy
  ) x
  where x.line is not null;

  return jsonb_build_object(
    'lines', coalesce(v_lines, '[]'::jsonb),
    'has_tags', v_tagged > 0,
    'speed', case
      when v_median is null or v_set_avg is null then null
      else jsonb_build_object(
        'set_avg_ms', round(v_set_avg),
        'personal_median_ms', round(v_median),
        'note', 'Kendi medyanınla karşılaştırma; evrensel hedef süre yok.'
      )
    end
  );
end;
$$;

revoke all on function public.diagnose_tagged_attempts(uuid[]) from public;
grant execute on function public.diagnose_tagged_attempts(uuid[]) to authenticated;

create or replace function public.admin_list_topic_questions(p_canonical_topic_id uuid, p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x))
    from (
      select q.id, q.stem, q.choices, q.correct_choice, q.explanation, q.difficulty, q.question_strategy,
             q.question_status, q.source_type, q.image_url, q.learning_objective_id, q.curriculum_question_set_id,
             s.set_type, q.created_at, q.is_published, q.trap_type, q.recommended_strategy, q.technique_role,
             q.question_pattern_id
      from public.questions q
      left join public.curriculum_question_sets s on s.id = q.curriculum_question_set_id
      where q.canonical_topic_id = p_canonical_topic_id
        and (p_status is null or q.question_status = p_status)
      order by q.created_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Factory pipeline note: pattern + technique design is required before publish (score gate).
comment on table public.exam_question_patterns is
  'Factory: master → decomposition → objectives → QUESTION PATTERN DESIGN → EXAM TECHNIQUE DESIGN → pedagogy → lesson → questions → media → validation.';

update public.content_factory_settings
set production_enabled = false,
    engine_state = case when engine_state = 'running' then engine_state else 'paused' end,
    updated_at = now()
where id = 1 and engine_state is distinct from 'running';
