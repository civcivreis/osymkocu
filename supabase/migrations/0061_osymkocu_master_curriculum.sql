-- Locked ÖSYM Koçu master curriculum OSYMKOCU_MASTER_2026_10_V1. No AI, no R2, engine stays paused.

alter table public.topic_catalog
  add column if not exists master_code text,
  add column if not exists content_scope text not null default 'core',
  add column if not exists is_dynamic boolean not null default false,
  add column if not exists last_verified_at timestamptz,
  add column if not exists source_date date,
  add column if not exists effective_from date,
  add column if not exists effective_to date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'topic_catalog_scope_check') then
    alter table public.topic_catalog
      add constraint topic_catalog_scope_check
      check (content_scope in ('core', 'core_plus_extension', 'exam_specific', 'dynamic_current_affairs'));
  end if;
end $$;

create unique index if not exists topic_catalog_master_code_uidx
  on public.topic_catalog (master_code)
  where master_code is not null;

alter table public.canonical_topics
  add column if not exists master_key text,
  add column if not exists content_scope text not null default 'core',
  add column if not exists is_dynamic boolean not null default false;

create unique index if not exists canonical_topics_master_key_uidx
  on public.canonical_topics (master_key)
  where master_key is not null;

create table if not exists public.curriculum_master_meta (
  id integer primary key default 1,
  version text not null,
  installed_at timestamptz not null default now(),
  payload_hash text,
  constraint curriculum_master_meta_one check (id = 1)
);

create table if not exists public.exam_test_blueprint (
  exam_code text primary key,
  structure jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.exam_test_blueprint (exam_code, structure) values
  ('TYT', '{"turkce":40,"sosyal":20,"temel_matematik":40,"fen":20}'::jsonb),
  ('AYT', '{"matematik":40,"fen":{"total":40,"fizik":14,"kimya":13,"biyoloji":13},"edebiyat_sosyal_1":{"total":40,"edebiyat":24,"tarih_1":10,"cografya_1":6},"sosyal_2":{"total":40,"tarih_2":11,"cografya_2":11,"felsefe_grubu":12,"din_veya_felsefe":6}}'::jsonb),
  ('KPSS_ORTAOGRETIM', '{"genel_yetenek":60,"genel_kultur":60}'::jsonb),
  ('KPSS_ONLISANS', '{"genel_yetenek":60,"genel_kultur":60}'::jsonb),
  ('KPSS_LISANS', '{"genel_yetenek":60,"genel_kultur":60,"scope":"GY_GK"}'::jsonb)
on conflict (exam_code) do update set structure = excluded.structure, updated_at = now();

create or replace function public.install_osymkocu_master_curriculum()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := $master${"version":"OSYMKOCU_MASTER_2026_10_V1","exams":[{"exam":"TYT","name":"TYT","subjects":[{"code":"TURKCE","name":"Türkçe","canon":"TURKCE","topics":["Sözcükte Anlam","Cümlede Anlam","Paragrafta Anlam","Paragrafta Yapı","Paragrafta Anlatım Teknikleri","Ses Bilgisi","Yazım Kuralları","Noktalama İşaretleri","Sözcükte Yapı ve Ekler","Sözcük Türleri","Fiiller","Ek Fiil","Fiilimsiler","Sözcük Grupları","Cümlenin Ögeleri","Fiilde Çatı","Cümle Türleri","Anlatım Bozuklukları","Sözel Muhakeme / Sözel Mantık"]},{"code":"MATEMATIK","name":"Matematik","canon":"MATEMATIK","topics":["Temel Kavramlar","Sayılar","Sayı Basamakları","Bölme ve Bölünebilme","Asal Sayılar ve Asal Çarpanlara Ayırma","EBOB – EKOK","Rasyonel Sayılar","Basit Eşitsizlikler","Mutlak Değer","Üslü Sayılar","Köklü Sayılar","Çarpanlara Ayırma","Oran – Orantı","Denklem Çözme","Problemler","Kümeler","Kartezyen Çarpım","Mantık","Fonksiyonlara Giriş","Polinomlara Giriş","İkinci Dereceden Denklemlere Giriş","Permütasyon","Kombinasyon","Binom","Olasılık","Veri – İstatistik","Tablo ve Grafik Yorumlama"]},{"code":"GEOMETRI","name":"Geometri","canon":"GEOMETRI","topics":["Geometrinin Temel Kavramları","Doğruda Açılar","Üçgende Açılar","Üçgende Açı-Kenar Bağıntıları","Özel Üçgenler","Dik Üçgen","İkizkenar ve Eşkenar Üçgen","Açıortay","Kenarortay","Üçgende Alan","Üçgende Eşlik ve Benzerlik","Çokgenler","Dörtgenler","Yamuk","Paralelkenar","Eşkenar Dörtgen ve Deltoid","Dikdörtgen","Kare","Çember ve Daire","Çemberde Açılar","Çemberde Uzunluk ve Alan","Noktanın Analitiği","Doğrunun Analitiği","Katı Cisimler","Prizma","Piramit","Silindir","Koni","Küre"]},{"code":"TARIH","name":"Tarih","canon":"TARIH","topics":["Tarih Bilimi ve Zaman","İlk Çağ Uygarlıkları","İlk Türk Devletleri","İslam Tarihi ve Uygarlığı","İlk Türk-İslam Devletleri","Orta Çağ'da Dünya","Türkiye Tarihi ve Anadolu'nun Türkleşmesi","Beylikten Devlete Osmanlı","Dünya Gücü Osmanlı","Osmanlı Kültür ve Medeniyeti","Yeni Çağ Avrupa Tarihi","XVII. Yüzyıl Osmanlı","XVIII. Yüzyıl Değişim ve Diplomasi","Yakın Çağ Avrupa Tarihi","XIX. Yüzyıl Osmanlı / En Uzun Yüzyıl","XX. Yüzyıl Başlarında Osmanlı","Mustafa Kemal'in Hayatı ve Fikir Dünyası","I. Dünya Savaşı ve Osmanlı","Mondros, İşgaller ve Cemiyetler","Millî Mücadele Hazırlık Dönemi","TBMM Dönemi","Kurtuluş Savaşı Cepheleri","Antlaşmalar","Türk İnkılabı","Atatürk İlkeleri","Atatürk Dönemi İç Politikası","Atatürk Dönemi Dış Politikası"]},{"code":"COGRAFYA","name":"Coğrafya","canon":"COGRAFYA","topics":["Doğa ve İnsan","Coğrafi Konum","Dünya'nın Şekli ve Hareketleri","Harita Bilgisi","Atmosfer ve Sıcaklık","Basınç ve Rüzgârlar","Nem ve Yağış","İklimler","Türkiye'nin İklimi","İç Kuvvetler","Dış Kuvvetler","Yer Şekilleri","Su – Toprak – Bitki","Nüfus","Göç","Yerleşme","Ekonomik Faaliyetler","Ulaşım","Bölgeler","Doğal Afetler","Çevre ve Toplum"]},{"code":"FELSEFE","name":"Felsefe","canon":"FELSEFE","topics":["Felsefenin Anlamı ve Alanı","Felsefi Düşüncenin Özellikleri","Bilgi Felsefesi","Varlık Felsefesi","Ahlak Felsefesi","Sanat Felsefesi","Din Felsefesi","Siyaset Felsefesi","Bilim Felsefesi","İlk Çağ Felsefesi","Orta Çağ Felsefesi","15–17. Yüzyıl Felsefesi","18–19. Yüzyıl Felsefesi","20. Yüzyıl Felsefesi"]},{"code":"DIN","name":"Din Kültürü","canon":"DIN","topics":["Bilgi ve İnanç","Din ve İslam","Allah – İnsan İlişkisi","İslam ve İbadet","Ahlak ve Değerler","Hz. Muhammed","Vahiy ve Akıl","Kur'an ve Ana Kavramları","İslam Düşüncesinde Yorumlar","Mezhepler ve Dinî Yorumlar","Din, Kültür ve Medeniyet","Güncel Dinî Meseleler","Yaşayan Dinler / Diğer Dinler"]},{"code":"FIZIK","name":"Fizik","canon":"FIZIK","topics":["Fizik Bilimine Giriş","Madde ve Özellikleri","Hareket","Kuvvet ve Newton Yasaları","İş – Güç – Enerji","Isı – Sıcaklık – Genleşme","Basınç","Kaldırma Kuvveti","Elektrostatik","Elektrik","Manyetizma","Dalgalar","Optik"]},{"code":"KIMYA","name":"Kimya","canon":"KIMYA","topics":["Kimya Bilimi","Atom ve Periyodik Sistem","Kimyasal Türler Arası Etkileşimler","Maddenin Hâlleri","Kimyanın Temel Kanunları","Mol ve Kimyasal Hesaplamalar","Karışımlar","Asit – Baz – Tuz","Kimya Her Yerde","Doğa ve Kimya"]},{"code":"BIYOLOJI","name":"Biyoloji","canon":"BIYOLOJI","topics":["Canlıların Ortak Özellikleri","Canlıların Temel Bileşenleri","Hücre","Hücre Organelleri","Hücre Zarından Madde Geçişleri","Canlıların Sınıflandırılması","Hücre Bölünmeleri","Mitoz ve Eşeysiz Üreme","Mayoz ve Eşeyli Üreme","Kalıtımın Temel İlkeleri","Ekosistem Ekolojisi","Çevre Sorunları ve Biyoçeşitlilik"]}]},{"exam":"AYT","name":"AYT","subjects":[{"code":"MATEMATIK","name":"Matematik","canon":"MATEMATIK","topics":["Fonksiyonlar","Polinomlar","İkinci Dereceden Denklemler","İkinci Dereceden Eşitsizlikler","Karmaşık Sayılar","Parabol","Permütasyon","Kombinasyon","Binom","Olasılık","Trigonometri","Trigonometrik Fonksiyonlar","Trigonometrik Özdeşlikler","Trigonometrik Denklemler","Üstel Fonksiyon","Logaritma","Logaritmik Denklemler ve Eşitsizlikler","Diziler","Limit","Süreklilik","Türev","Türevin Uygulamaları","İntegral","İntegralin Uygulamaları"]},{"code":"GEOMETRI","name":"Geometri","canon":"GEOMETRI","topics":["Üçgenler – İleri Uygulamalar","Çokgenler","Dörtgenler","Çember ve Daire","Çemberin Analitiği","Noktanın Analitiği","Doğrunun Analitiği","Dönüşüm Geometrisi","Katı Cisimler"]},{"code":"FIZIK","name":"Fizik","canon":"FIZIK","topics":["Vektörler","Kuvvet – Tork – Denge","Kütle Merkezi","Basit Makineler","Hareket","Newton'un Hareket Yasaları","İş – Enerji – Güç","İtme ve Momentum","Elektriksel Kuvvet ve Elektrik Alan","Elektriksel Potansiyel","Sığa ve Kondansatörler","Manyetik Alan","Elektromanyetik İndüksiyon","Alternatif Akım","Transformatörler","Çembersel Hareket","Dönme Hareketi","Açısal Momentum","Kütle Çekimi","Kepler Yasaları","Basit Harmonik Hareket","Dalga Mekaniği","Elektromanyetik Dalgalar","Atom Fiziğine Giriş","Modern Fizik","Özel Görelilik","Kuantum Fiziğine Giriş","Fotoelektrik Olay","Modern Fiziğin Teknolojideki Uygulamaları"]},{"code":"KIMYA","name":"Kimya","canon":"KIMYA","topics":["Modern Atom Teorisi","Periyodik Sistem – İleri Düzey","Gazlar","Sıvı Çözeltiler","Çözünürlük","Kimyasal Tepkimelerde Enerji","Tepkime Hızları","Kimyasal Denge","Asit – Baz Dengesi","Çözünürlük Dengesi","Kimya ve Elektrik","Elektrokimyasal Hücreler","Elektroliz","Karbon Kimyasına Giriş","Organik Kimya","Hidrokarbonlar","Organik Bileşik Sınıfları","Enerji Kaynakları ve Bilimsel Gelişmeler"]},{"code":"BIYOLOJI","name":"Biyoloji","canon":"BIYOLOJI","topics":["Sinir Sistemi","Endokrin Sistem","Duyu Organları","Destek ve Hareket Sistemi","Sindirim Sistemi","Dolaşım Sistemi","Bağışıklık","Solunum Sistemi","Üriner Sistem","Üreme Sistemi ve Embriyonik Gelişim","Komünite Ekolojisi","Popülasyon Ekolojisi","Nükleik Asitler","Genetik Şifre ve Protein Sentezi","Genetik Mühendisliği","Biyoteknoloji","Fotosentez","Kemosentez","Hücresel Solunum","Bitki Biyolojisi","Bitkilerde Taşıma","Bitkilerde Üreme","Bitkisel Hormonlar","Canlılar ve Çevre"]},{"code":"EDEBIYAT","name":"Türk Dili ve Edebiyatı","canon":"EDEBIYAT","topics":["Güzel Sanatlar ve Edebiyat","Edebiyatın Bilimlerle İlişkisi","Metinlerin Sınıflandırılması","Şiir Bilgisi","Nazım Biçimleri ve Türleri","Edebî Sanatlar","İslamiyet Öncesi Türk Edebiyatı","Geçiş Dönemi Türk Edebiyatı","Halk Edebiyatı","Anonim Halk Edebiyatı","Âşık Edebiyatı","Tekke – Tasavvuf Edebiyatı","Divan Edebiyatı","Tanzimat Edebiyatı","Servetifünun Edebiyatı","Fecr-i Âti","Millî Edebiyat","Cumhuriyet Dönemi Şiiri","Cumhuriyet Dönemi Roman ve Hikâye","Cumhuriyet Dönemi Tiyatro","Cumhuriyet Dönemi Öğretici Metinler","Edebî Akımlar","Dünya Edebiyatı","Sanatçı – Eser Eşleştirmeleri","Roman Bilgisi","Hikâye Bilgisi","Tiyatro","Öğretici Metinler"]},{"code":"TARIH","name":"Tarih","canon":"TARIH","topics":["Tarih ve Zaman","İnsanlığın İlk Dönemleri","Orta Çağ'da Dünya","İlk ve Orta Çağlarda Türk Dünyası","İslam Medeniyetinin Doğuşu","Türklerin İslamiyet'i Kabulü ve İlk Türk-İslam Devletleri","Yerleşme ve Devletleşme Sürecinde Selçuklu Türkiyesi","Beylikten Devlete Osmanlı","Dünya Gücü Osmanlı","Osmanlı Devlet Teşkilatı","Osmanlı Kültür ve Medeniyeti","Değişen Dünya Dengeleri Karşısında Osmanlı","Değişim Çağında Avrupa ve Osmanlı","Uluslararası İlişkilerde Denge Stratejisi","XIX. ve XX. Yüzyılda Osmanlı","I. Dünya Savaşı","Millî Mücadele","Atatürk İlke ve İnkılapları","İki Savaş Arası Dönem","II. Dünya Savaşı","Soğuk Savaş Dönemi","Yumuşama Dönemi","Küreselleşen Dünya","Türklerde Devlet Teşkilatı","Türklerde Toplum ve Hukuk","Türklerde Ekonomi","Türklerde Eğitim ve Bilim","Türklerde Sanat"]},{"code":"COGRAFYA","name":"Coğrafya","canon":"COGRAFYA","topics":["Ekosistemlerin Özellikleri","Biyoçeşitlilik","Madde Döngüleri","Su Ekosistemleri","Nüfus Politikaları","Türkiye'nin Nüfus Politikaları","Şehirler ve Etki Alanları","Ekonomik Faaliyetler ve Doğal Kaynaklar","Türkiye Ekonomisi","Türkiye'de Tarım","Türkiye'de Hayvancılık","Türkiye'de Maden ve Enerji","Türkiye'de Sanayi","Türkiye'de Ulaşım","Türkiye'de Ticaret","Türkiye'de Turizm","Kültür Bölgeleri","Küresel Ticaret","Jeopolitik","Ülkeler ve Bölgeler","Çevre Sorunları","Doğal Kaynakların Kullanımı","Doğal Afetler","Sürdürülebilirlik"]},{"code":"FELSEFE","name":"Felsefe","canon":"FELSEFE","topics":["Felsefeye Giriş","Bilgi Felsefesi","Varlık Felsefesi","Ahlak Felsefesi","Din Felsefesi","Siyaset Felsefesi","Sanat Felsefesi","Bilim Felsefesi","Felsefe Tarihi"]},{"code":"PSIKOLOJI","name":"Psikoloji","canon":"PSIKOLOJI","topics":["Psikoloji Bilimini Tanıma","Psikolojinin Temel Süreçleri","Öğrenme","Bellek","Düşünme","Ruh Sağlığının Temelleri","Bireysel Farklılıklar"]},{"code":"SOSYOLOJI","name":"Sosyoloji","canon":"SOSYOLOJI","topics":["Sosyolojiye Giriş","Birey ve Toplum","Toplumsal Yapı","Toplumsal Değişme","Kültür","Toplumsal Kurumlar"]},{"code":"MANTIK","name":"Mantık","canon":"MANTIK","topics":["Mantığa Giriş","Kavram ve Terim","Önermeler","Çıkarım","Klasik Mantık","Sembolik Mantık"]},{"code":"DIN","name":"Din Kültürü","canon":"DIN","topics":["İnanç","İbadet","Ahlak","Kur'an ve Yorumu","Hz. Muhammed","İslam Düşüncesinde Yorumlar","İslam ve Bilim","İslam ve Kültür","Dinler ve İnançlar","Güncel Dinî Meseleler"]}]},{"exam":"KPSS_ORTAOGRETIM","name":"KPSS Ortaöğretim","subjects":[{"code":"TURKCE","name":"Türkçe","canon":"TURKCE","topics":["Sözcükte Anlam","Cümlede Anlam","Paragrafta Anlam","Paragrafta Yapı","Anlatım Biçimleri ve Düşünceyi Geliştirme Yolları","Ses Bilgisi","Yazım Kuralları","Noktalama İşaretleri","Sözcükte Yapı","Sözcük Türleri","Fiiller","Fiilimsiler","Ek Fiil","Sözcük Grupları","Cümlenin Ögeleri","Fiilde Çatı","Cümle Türleri","Anlatım Bozuklukları","Sözel Mantık / Sözel Muhakeme"]},{"code":"MATEMATIK","name":"Matematik","canon":"MATEMATIK","topics":["Temel Kavramlar","Sayılar","Sayı Basamakları","Bölme ve Bölünebilme","Asal Sayılar ve Asal Çarpanlar","EBOB – EKOK","Birinci Dereceden Denklemler","Rasyonel Sayılar","Eşitsizlikler","Mutlak Değer","Üslü Sayılar","Köklü Sayılar","Çarpanlara Ayırma","Oran – Orantı","Problemler","Kümeler","Fonksiyon","Permütasyon","Kombinasyon","Olasılık","Modüler Aritmetik","Tablo ve Grafik","Sayısal Mantık"]},{"code":"GEOMETRI","name":"Geometri","canon":"GEOMETRI","topics":["Geometrik Kavramlar","Açılar","Üçgenler","Üçgende Alan","Benzerlik","Çokgenler","Dörtgenler","Çember ve Daire","Analitik Geometri Temelleri","Katı Cisimler"]},{"code":"TARIH","name":"Tarih","canon":"TARIH","topics":["İslamiyet Öncesi Türk Tarihi","Türk-İslam Tarihi","Türkiye Tarihi","Osmanlı Devleti Kuruluş ve Yükselme","Osmanlı Kültür ve Medeniyeti","XVII. Yüzyıl Osmanlı","XVIII. Yüzyıl Osmanlı","XIX. Yüzyıl Osmanlı","Osmanlı Yenileşme ve Demokratikleşme Hareketleri","Avrupa'daki Gelişmeler ve Osmanlı'ya Etkileri","XX. Yüzyıl Başlarında Osmanlı","I. Dünya Savaşı","Mondros – İşgaller – Cemiyetler","Millî Mücadele Hazırlık Dönemi","I. TBMM","Kurtuluş Savaşı Cepheleri","Kurtuluş Savaşı Antlaşmaları","Lozan","Atatürk İlke ve İnkılapları","Cumhuriyet Dönemi İç Politikası","Atatürk Dönemi Dış Politikası","Atatürk Sonrası Türkiye","Çağdaş Türk ve Dünya Tarihi"]},{"code":"COGRAFYA","name":"Coğrafya","canon":"COGRAFYA","topics":["Türkiye'nin Coğrafi Konumu","Türkiye'nin Matematik Konumu","Türkiye'nin Özel Konumu","Türkiye'nin Yer Şekilleri","Türkiye'nin Jeolojik Yapısı","İç Kuvvetler","Dış Kuvvetler","Türkiye'nin İklimi","Sıcaklık","Basınç ve Rüzgâr","Yağış","Türkiye'nin Bitki Örtüsü","Türkiye'nin Toprakları","Türkiye'nin Akarsuları","Göller","Nüfus","Nüfus Dağılışı","Göç","Yerleşme","Tarım","Hayvancılık","Ormancılık","Madenler","Enerji Kaynakları","Sanayi","Ulaşım","Ticaret","Turizm","Bölgeler","Bölgesel Kalkınma Projeleri","Doğal Afetler","Çevre Sorunları"]},{"code":"VATANDASLIK","name":"Vatandaşlık","canon":"VATANDASLIK","topics":["Hukukun Temel Kavramları","Hukuk Kuralları ve Yaptırımlar","Hukukun Dalları","Hak Kavramı","Kişiler Hukuku Temelleri","Devlet Kavramı","Devlet Biçimleri","Demokrasi","Kuvvetler Ayrılığı","Anayasa Hukukunun Temel Kavramları","Türk Anayasa Tarihi","1982 Anayasasının Genel Esasları","Temel Hak ve Hürriyetler","Yasama","TBMM'nin Yapısı","Milletvekilliği","TBMM'nin Görev ve Yetkileri","Kanun Yapım Süreci","Yürütme","Cumhurbaşkanı","Cumhurbaşkanlığı Teşkilatı Temelleri","Yargı","Yüksek Mahkemeler","Anayasa Yargısı","İdare Hukuku","Merkezi Yönetim","Yerinden Yönetim","Mahallî İdareler","Kamu Görevlileri","İdari İşlemler"]},{"code":"GUNCEL","name":"Güncel Bilgiler","canon":"GUNCEL","topics":["Güncel Bilgiler"],"dynamic":true}]},{"exam":"KPSS_ONLISANS","name":"KPSS Önlisans","subjects":[{"code":"TURKCE","name":"Türkçe","canon":"TURKCE","topics":["Sözcükte Anlam","Cümlede Anlam","Paragrafta Anlam","Paragrafta Yapı","Anlatım Biçimleri ve Düşünceyi Geliştirme Yolları","Ses Bilgisi","Yazım Kuralları","Noktalama İşaretleri","Sözcükte Yapı","Sözcük Türleri","Fiiller","Fiilimsiler","Ek Fiil","Sözcük Grupları","Cümlenin Ögeleri","Fiilde Çatı","Cümle Türleri","Anlatım Bozuklukları","Sözel Mantık / Sözel Muhakeme"]},{"code":"MATEMATIK","name":"Matematik","canon":"MATEMATIK","topics":["Temel Kavramlar","Sayılar","Sayı Basamakları","Bölme ve Bölünebilme","Asal Sayılar ve Asal Çarpanlar","EBOB – EKOK","Birinci Dereceden Denklemler","Rasyonel Sayılar","Eşitsizlikler","Mutlak Değer","Üslü Sayılar","Köklü Sayılar","Çarpanlara Ayırma","Oran – Orantı","Problemler","Kümeler","Fonksiyon","Permütasyon","Kombinasyon","Olasılık","Modüler Aritmetik","Tablo ve Grafik","Sayısal Mantık"]},{"code":"GEOMETRI","name":"Geometri","canon":"GEOMETRI","topics":["Geometrik Kavramlar","Açılar","Üçgenler","Üçgende Alan","Benzerlik","Çokgenler","Dörtgenler","Çember ve Daire","Analitik Geometri Temelleri","Katı Cisimler"]},{"code":"TARIH","name":"Tarih","canon":"TARIH","topics":["İslamiyet Öncesi Türk Tarihi","Türk-İslam Tarihi","Türkiye Tarihi","Osmanlı Devleti Kuruluş ve Yükselme","Osmanlı Kültür ve Medeniyeti","XVII. Yüzyıl Osmanlı","XVIII. Yüzyıl Osmanlı","XIX. Yüzyıl Osmanlı","Osmanlı Yenileşme ve Demokratikleşme Hareketleri","Avrupa'daki Gelişmeler ve Osmanlı'ya Etkileri","XX. Yüzyıl Başlarında Osmanlı","I. Dünya Savaşı","Mondros – İşgaller – Cemiyetler","Millî Mücadele Hazırlık Dönemi","I. TBMM","Kurtuluş Savaşı Cepheleri","Kurtuluş Savaşı Antlaşmaları","Lozan","Atatürk İlke ve İnkılapları","Cumhuriyet Dönemi İç Politikası","Atatürk Dönemi Dış Politikası","Atatürk Sonrası Türkiye","Çağdaş Türk ve Dünya Tarihi"]},{"code":"COGRAFYA","name":"Coğrafya","canon":"COGRAFYA","topics":["Türkiye'nin Coğrafi Konumu","Türkiye'nin Matematik Konumu","Türkiye'nin Özel Konumu","Türkiye'nin Yer Şekilleri","Türkiye'nin Jeolojik Yapısı","İç Kuvvetler","Dış Kuvvetler","Türkiye'nin İklimi","Sıcaklık","Basınç ve Rüzgâr","Yağış","Türkiye'nin Bitki Örtüsü","Türkiye'nin Toprakları","Türkiye'nin Akarsuları","Göller","Nüfus","Nüfus Dağılışı","Göç","Yerleşme","Tarım","Hayvancılık","Ormancılık","Madenler","Enerji Kaynakları","Sanayi","Ulaşım","Ticaret","Turizm","Bölgeler","Bölgesel Kalkınma Projeleri","Doğal Afetler","Çevre Sorunları"]},{"code":"VATANDASLIK","name":"Vatandaşlık","canon":"VATANDASLIK","topics":["Hukukun Temel Kavramları","Hukuk Kuralları ve Yaptırımlar","Hukukun Dalları","Hak Kavramı","Kişiler Hukuku Temelleri","Devlet Kavramı","Devlet Biçimleri","Demokrasi","Kuvvetler Ayrılığı","Anayasa Hukukunun Temel Kavramları","Türk Anayasa Tarihi","1982 Anayasasının Genel Esasları","Temel Hak ve Hürriyetler","Yasama","TBMM'nin Yapısı","Milletvekilliği","TBMM'nin Görev ve Yetkileri","Kanun Yapım Süreci","Yürütme","Cumhurbaşkanı","Cumhurbaşkanlığı Teşkilatı Temelleri","Yargı","Yüksek Mahkemeler","Anayasa Yargısı","İdare Hukuku","Merkezi Yönetim","Yerinden Yönetim","Mahallî İdareler","Kamu Görevlileri","İdari İşlemler"]},{"code":"GUNCEL","name":"Güncel Bilgiler","canon":"GUNCEL","topics":["Güncel Bilgiler"],"dynamic":true}]},{"exam":"KPSS_LISANS","name":"KPSS Lisans","subjects":[{"code":"TURKCE","name":"Türkçe","canon":"TURKCE","topics":["Sözcükte Anlam","Cümlede Anlam","Paragrafta Anlam","Paragrafta Yapı","Anlatım Biçimleri ve Düşünceyi Geliştirme Yolları","Ses Bilgisi","Yazım Kuralları","Noktalama İşaretleri","Sözcükte Yapı","Sözcük Türleri","Fiiller","Fiilimsiler","Ek Fiil","Sözcük Grupları","Cümlenin Ögeleri","Fiilde Çatı","Cümle Türleri","Anlatım Bozuklukları","Sözel Mantık / Sözel Muhakeme"]},{"code":"MATEMATIK","name":"Matematik","canon":"MATEMATIK","topics":["Temel Kavramlar","Sayılar","Sayı Basamakları","Bölme ve Bölünebilme","Asal Sayılar ve Asal Çarpanlar","EBOB – EKOK","Birinci Dereceden Denklemler","Rasyonel Sayılar","Eşitsizlikler","Mutlak Değer","Üslü Sayılar","Köklü Sayılar","Çarpanlara Ayırma","Oran – Orantı","Problemler","Kümeler","Fonksiyon","Permütasyon","Kombinasyon","Olasılık","Modüler Aritmetik","Tablo ve Grafik","Sayısal Mantık"]},{"code":"GEOMETRI","name":"Geometri","canon":"GEOMETRI","topics":["Geometrik Kavramlar","Açılar","Üçgenler","Üçgende Alan","Benzerlik","Çokgenler","Dörtgenler","Çember ve Daire","Analitik Geometri Temelleri","Katı Cisimler"]},{"code":"TARIH","name":"Tarih","canon":"TARIH","topics":["İslamiyet Öncesi Türk Tarihi","Türk-İslam Tarihi","Türkiye Tarihi","Osmanlı Devleti Kuruluş ve Yükselme","Osmanlı Kültür ve Medeniyeti","XVII. Yüzyıl Osmanlı","XVIII. Yüzyıl Osmanlı","XIX. Yüzyıl Osmanlı","Osmanlı Yenileşme ve Demokratikleşme Hareketleri","Avrupa'daki Gelişmeler ve Osmanlı'ya Etkileri","XX. Yüzyıl Başlarında Osmanlı","I. Dünya Savaşı","Mondros – İşgaller – Cemiyetler","Millî Mücadele Hazırlık Dönemi","I. TBMM","Kurtuluş Savaşı Cepheleri","Kurtuluş Savaşı Antlaşmaları","Lozan","Atatürk İlke ve İnkılapları","Cumhuriyet Dönemi İç Politikası","Atatürk Dönemi Dış Politikası","Atatürk Sonrası Türkiye","Çağdaş Türk ve Dünya Tarihi"]},{"code":"COGRAFYA","name":"Coğrafya","canon":"COGRAFYA","topics":["Türkiye'nin Coğrafi Konumu","Türkiye'nin Matematik Konumu","Türkiye'nin Özel Konumu","Türkiye'nin Yer Şekilleri","Türkiye'nin Jeolojik Yapısı","İç Kuvvetler","Dış Kuvvetler","Türkiye'nin İklimi","Sıcaklık","Basınç ve Rüzgâr","Yağış","Türkiye'nin Bitki Örtüsü","Türkiye'nin Toprakları","Türkiye'nin Akarsuları","Göller","Nüfus","Nüfus Dağılışı","Göç","Yerleşme","Tarım","Hayvancılık","Ormancılık","Madenler","Enerji Kaynakları","Sanayi","Ulaşım","Ticaret","Turizm","Bölgeler","Bölgesel Kalkınma Projeleri","Doğal Afetler","Çevre Sorunları"]},{"code":"VATANDASLIK","name":"Vatandaşlık","canon":"VATANDASLIK","topics":["Hukukun Temel Kavramları","Hukuk Kuralları ve Yaptırımlar","Hukukun Dalları","Hak Kavramı","Kişiler Hukuku Temelleri","Devlet Kavramı","Devlet Biçimleri","Demokrasi","Kuvvetler Ayrılığı","Anayasa Hukukunun Temel Kavramları","Türk Anayasa Tarihi","1982 Anayasasının Genel Esasları","Temel Hak ve Hürriyetler","Yasama","TBMM'nin Yapısı","Milletvekilliği","TBMM'nin Görev ve Yetkileri","Kanun Yapım Süreci","Yürütme","Cumhurbaşkanı","Cumhurbaşkanlığı Teşkilatı Temelleri","Yargı","Yüksek Mahkemeler","Anayasa Yargısı","İdare Hukuku","Merkezi Yönetim","Yerinden Yönetim","Mahallî İdareler","Kamu Görevlileri","İdari İşlemler"]},{"code":"GUNCEL","name":"Güncel Bilgiler","canon":"GUNCEL","topics":["Güncel Bilgiler"],"dynamic":true}]}]}$master$::jsonb;
  v_exam jsonb;
  v_subj jsonb;
  v_name text;
  v_exam_id uuid;
  v_subject_id uuid;
  v_unit_id uuid;
  v_cs uuid;
  v_cu uuid;
  v_ct uuid;
  v_version uuid;
  v_code text;
  v_master text;
  v_key text;
  v_slug text;
  v_sort int;
  v_subj_ord int;
  v_dynamic boolean;
  v_scope text;
  v_broad boolean;
  v_seg text;
  v_seg_i int;
  v_topics int := 0;
begin
  perform public.bootstrap_supported_exams();

  for v_exam in select value from jsonb_array_elements(v_payload->'exams')
  loop
    select id into v_exam_id from public.exam_catalog where code = v_exam->>'exam';
    if v_exam_id is null then continue; end if;

    for v_subj, v_subj_ord in
      select value, ordinality::int from jsonb_array_elements(v_exam->'subjects') with ordinality
    loop
      v_code := v_subj->>'code';
      insert into public.canonical_subjects (code, name, slug)
      select v_subj->>'canon', v_subj->>'name', public.catalog_slug_from_name(v_subj->>'canon')
      where not exists (select 1 from public.canonical_subjects c where c.slug = public.catalog_slug_from_name(v_subj->>'canon') or c.code = v_subj->>'canon');
      select id into v_cs from public.canonical_subjects
      where code = v_subj->>'canon' or slug = public.catalog_slug_from_name(v_subj->>'canon')
      order by case when code = v_subj->>'canon' then 0 else 1 end
      limit 1;
      update public.canonical_subjects set code = coalesce(code, v_subj->>'canon') where id = v_cs and code is null;

      insert into public.canonical_units (canonical_subject_id, name, slug)
      select v_cs, 'Ana Müfredat', 'master'
      where not exists (select 1 from public.canonical_units u where u.canonical_subject_id = v_cs and u.slug = 'master');
      select id into v_cu from public.canonical_units where canonical_subject_id = v_cs and slug = 'master';

      insert into public.subject_catalog (exam_id, code, name, sort_order, is_active, canonical_subject_id)
      values (v_exam_id, v_code, v_subj->>'name', v_subj_ord, true, v_cs)
      on conflict (exam_id, code) do update
        set name = excluded.name, canonical_subject_id = excluded.canonical_subject_id, is_active = true, sort_order = excluded.sort_order;
      select id into v_subject_id from public.subject_catalog where exam_id = v_exam_id and code = v_code;

      insert into public.unit_catalog (subject_id, code, name, sort_order, is_active, canonical_unit_id)
      values (v_subject_id, 'MASTER', v_subj->>'name', 0, true, v_cu)
      on conflict (subject_id, code) where code is not null do update
        set name = excluded.name, canonical_unit_id = excluded.canonical_unit_id, is_active = true;
      select id into v_unit_id from public.unit_catalog where subject_id = v_subject_id and code = 'MASTER';

      v_dynamic := coalesce((v_subj->>'dynamic')::boolean, false);
      v_sort := 0;
      for v_name in select jsonb_array_elements_text(v_subj->'topics')
      loop
        v_sort := v_sort + 1;
        v_master := v_exam->>'exam' || '_' || v_code || '_' || public.catalog_code_from_name(v_name);
        v_key := v_subj->>'canon' || '|' || public.catalog_slug_from_name(v_name);
        v_slug := public.catalog_slug_from_name(v_name);
        v_scope := case when v_dynamic then 'dynamic_current_affairs' else 'core' end;
        v_broad := v_name = any (array['Problemler','İslamiyet Öncesi Türk Tarihi','Türk-İslam Tarihi','Türkiye Tarihi','Osmanlı Devleti Kuruluş ve Yükselme','Osmanlı Kültür ve Medeniyeti','Millî Mücadele','Millî Mücadele Hazırlık Dönemi','Atatürk İlke ve İnkılapları','Türk İnkılabı','Sanatçı – Eser Eşleştirmeleri']);

        insert into public.canonical_topics (canonical_unit_id, name, slug, master_key, content_scope, is_dynamic, too_broad, analysis_status)
        select v_cu, v_name, v_slug, v_key, v_scope, v_dynamic, v_broad, case when v_broad then 'split_recommended' else 'unanalyzed' end
        where not exists (select 1 from public.canonical_topics t where t.master_key = v_key);
        select id into v_ct from public.canonical_topics where master_key = v_key;
        update public.canonical_topics
        set name = v_name, too_broad = v_broad or too_broad, content_scope = v_scope, is_dynamic = v_dynamic
        where id = v_ct;

        if exists (select 1 from public.topic_catalog t where t.unit_id = v_unit_id and lower(t.name) = lower(v_name)) then
          update public.topic_catalog
          set code = v_master, master_code = v_master, sort_order = v_sort, canonical_topic_id = v_ct,
              content_scope = v_scope, is_dynamic = v_dynamic, is_active = true
          where unit_id = v_unit_id and lower(name) = lower(v_name);
        elsif exists (select 1 from public.topic_catalog t where t.master_code = v_master) then
          update public.topic_catalog
          set name = v_name, sort_order = v_sort, canonical_topic_id = v_ct, unit_id = v_unit_id,
              content_scope = v_scope, is_dynamic = v_dynamic, is_active = true
          where master_code = v_master;
        else
          insert into public.topic_catalog (unit_id, code, name, sort_order, is_active, content_status, canonical_topic_id, master_code, content_scope, is_dynamic)
          values (v_unit_id, v_master, v_name, v_sort, true, 'empty', v_ct, v_master, v_scope, v_dynamic);
        end if;
        v_topics := v_topics + 1;
      end loop;
    end loop;
  end loop;

  -- Seed pedagogical segments for broad master topics (taxonomy only).
  for v_ct, v_key in select id, master_key from public.canonical_topics where master_key is not null
  loop
    if split_part(v_key, '|', 2) = public.catalog_slug_from_name('Problemler') then
      v_seg_i := 0;
      foreach v_seg in array array['Sayı problemleri','Kesir problemleri','Yaş problemleri','Yüzde problemleri','Kâr-zarar','Karışım','İşçi-havuz','Hareket','Oran-orantı problemleri','Grafik/tablo problemleri','Rutin olmayan problemler']
      loop
        v_seg_i := v_seg_i + 1;
        insert into public.canonical_topic_segments (canonical_topic_id, title, slug, segment_order, should_have_own_lesson, estimated_minutes)
        select v_ct, v_seg, public.catalog_slug_from_name(v_seg) || '-' || v_seg_i::text, v_seg_i, true, 8
        where not exists (
          select 1 from public.canonical_topic_segments s
          where s.canonical_topic_id = v_ct and lower(s.title) = lower(v_seg)
        );
      end loop;
    end if;
  end loop;

  perform public.seed_master_topic_segments();

  -- Map into default curriculum versions.
  for v_exam_id in
    select id from public.exam_catalog where code in ('TYT','AYT','KPSS_ORTAOGRETIM','KPSS_ONLISANS','KPSS_LISANS')
  loop
    select id into v_version from public.get_active_curriculum_version(v_exam_id);
    if v_version is null then
      select id into v_version from public.curriculum_versions where exam_id = v_exam_id and status <> 'archived' order by is_default desc, created_at limit 1;
    end if;
    if v_version is null then continue; end if;

    insert into public.exam_topic_map (
      curriculum_version_id, canonical_topic_id, subject_id, unit_id, topic_id,
      included, coverage_mode, depth_level, priority, sort_order
    )
    select v_version, t.canonical_topic_id, s.id, u.id, t.id, true,
           case when t.is_dynamic then 'exam_specific' else 'core' end,
           'standard', 'normal', t.sort_order
    from public.topic_catalog t
    join public.unit_catalog u on u.id = t.unit_id
    join public.subject_catalog s on s.id = u.subject_id
    where s.exam_id = v_exam_id and u.code = 'MASTER' and t.canonical_topic_id is not null and t.is_active and not t.is_dynamic
    on conflict (curriculum_version_id, canonical_topic_id) do update
      set included = true, subject_id = excluded.subject_id, unit_id = excluded.unit_id, topic_id = excluded.topic_id, sort_order = excluded.sort_order;
  end loop;

  -- Hide legacy non-master units for the five exams (keep rows; do not delete lessons).
  update public.unit_catalog u
  set is_active = false
  from public.subject_catalog s
  join public.exam_catalog e on e.id = s.exam_id
  where u.subject_id = s.id
    and e.code in ('TYT','AYT','KPSS_ORTAOGRETIM','KPSS_ONLISANS','KPSS_LISANS')
    and coalesce(u.code, '') is distinct from 'MASTER';

  insert into public.curriculum_master_meta (id, version, installed_at)
  values (1, 'OSYMKOCU_MASTER_2026_10_V1', now())
  on conflict (id) do update set version = excluded.version, installed_at = now();

  update public.content_factory_settings
  set production_enabled = false,
      engine_state = case when engine_state = 'running' then engine_state else 'paused' end,
      updated_at = now()
  where id = 1 and engine_state is distinct from 'running';

  return jsonb_build_object('version', 'OSYMKOCU_MASTER_2026_10_V1', 'topics_touched', v_topics);
end;
$$;

create or replace function public.seed_master_topic_segments()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_titles text[];
  v_title text;
  i int;
begin
  for r in select id, name, master_key from public.canonical_topics where master_key is not null
  loop
    v_titles := case
      when r.name = 'İslamiyet Öncesi Türk Tarihi' then array['Türk adının anlamı','Türklerin ana yurdu','Türk göçleri','İskitler','Asya Hun Devleti','Avrupa Hun Devleti','I. Göktürk','II. Göktürk','Uygurlar','Diğer Türk toplulukları','Devlet teşkilatı','Kut anlayışı','İkili teşkilat','Kurultay','Töre','Ordu-millet','Sosyal hayat','Ekonomi','Din ve inanış','Yazı/dil','Orhun Yazıtları','Kültür ve sanat']
      when r.name = 'Türk-İslam Tarihi' then array['Talas','Karahanlılar','Gazneliler','Büyük Selçuklu','Harzemşahlar','Atabeylikler','İlk Türk-İslam eserleri','Bilim insanları','Devlet teşkilatı','Kültür-medeniyet']
      when r.name = 'Türkiye Tarihi' then array['Malazgirt','Anadolu Selçuklu','Haçlı Seferleri','Miryokefalon','Kösedağ','Anadolu beylikleri']
      when r.name = 'Osmanlı Devleti Kuruluş ve Yükselme' then array['Kuruluş','Yükselme','Merkezi yönetim','Saray','Divan','Toprak sistemi','Tımar','Ordu','Hukuk','Eğitim','Ekonomi','Toplum','Bilim/sanat']
      when r.name in ('Millî Mücadele') then array['Mondros','İşgaller','Cemiyetler','Amasya','Kongreler','Misak-ı Millî','TBMM''nin açılışı','İç isyanlar','Sevr','Doğu Cephesi','Güney Cephesi','Batı Cephesi','İnönü','Sakarya','Büyük Taarruz','Mudanya','Lozan']
      when r.name in ('Atatürk İlke ve İnkılapları','Türk İnkılabı') then array['Siyasal inkılaplar','Hukuk inkılapları','Eğitim ve kültür inkılapları','Toplumsal inkılaplar','Ekonomik inkılaplar','Atatürk ilkeleri','Bütünleyici ilkeler']
      when r.name = 'Güncel Bilgiler' then array['Türkiye gündemi','Dünya gündemi','Ekonomi','Bilim ve teknoloji','Kültür ve sanat','Spor','Uluslararası kuruluşlar','Önemli yıl dönümleri','Ödüller','Önemli resmî gelişmeler']
      when r.name = 'Sanatçı – Eser Eşleştirmeleri' then array['Yazar','Eser','Dönem','Tür','Akım']
      else null
    end;
    if v_titles is null then continue; end if;
    i := 0;
    foreach v_title in array v_titles
    loop
      i := i + 1;
      insert into public.canonical_topic_segments (canonical_topic_id, title, slug, segment_order, should_have_own_lesson, estimated_minutes, decomposition_reason)
      select r.id, v_title, left(public.catalog_slug_from_name(v_title) || '-' || i::text, 80), i, true, 8, 'master_seed'
      where not exists (
        select 1 from public.canonical_topic_segments s where s.canonical_topic_id = r.id and lower(s.title) = lower(v_title)
      );
    end loop;
  end loop;

  -- Rehome leftover KPSS sample topics as segments of İslamiyet Öncesi Türk Tarihi.
  insert into public.canonical_topic_segments (canonical_topic_id, title, slug, segment_order, should_have_own_lesson, estimated_minutes, decomposition_reason)
  select p.id, t.name, left(public.catalog_slug_from_name(t.name) || '-legacy', 80), 100 + t.sort_order, true, 8, 'legacy_sample'
  from public.topic_catalog t
  join public.unit_catalog u on u.id = t.unit_id
  join public.subject_catalog s on s.id = u.subject_id
  join public.exam_catalog e on e.id = s.exam_id
  join public.canonical_topics p on p.master_key = 'TARIH|' || public.catalog_slug_from_name('İslamiyet Öncesi Türk Tarihi')
  where e.code like 'KPSS%'
    and coalesce(u.code,'') is distinct from 'MASTER'
    and t.canonical_topic_id is not null
    and not exists (
      select 1 from public.canonical_topic_segments x where x.canonical_topic_id = p.id and lower(x.title) = lower(t.name)
    );
end;
$$;

create or replace function public.bootstrap_supported_exams()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.exam_catalog (code, name, is_active, sort_order)
  select x.code, x.name, true, x.sort_order
  from (values
    ('TYT', 'TYT', 10),
    ('AYT', 'AYT', 20),
    ('KPSS_ORTAOGRETIM', 'KPSS Ortaöğretim', 30),
    ('KPSS_ONLISANS', 'KPSS Önlisans', 40),
    ('KPSS_LISANS', 'KPSS Lisans', 50)
  ) as x(code, name, sort_order)
  where not exists (select 1 from public.exam_catalog e where e.code = x.code);

  update public.exam_catalog e
  set name = x.name, is_active = true, sort_order = x.sort_order
  from (values
    ('TYT', 'TYT', 10),
    ('AYT', 'AYT', 20),
    ('KPSS_ORTAOGRETIM', 'KPSS Ortaöğretim', 30),
    ('KPSS_ONLISANS', 'KPSS Önlisans', 40),
    ('KPSS_LISANS', 'KPSS Lisans', 50)
  ) as x(code, name, sort_order)
  where e.code = x.code;

  insert into public.curriculum_versions (exam_id, code, name, revision_label, status, is_default, manually_activated)
  select e.id, e.code || '_CURRENT', 'Güncel ' || e.name || ' Müfredatı', 'Revizyon 1', 'draft', true, false
  from public.exam_catalog e
  where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
    and not exists (select 1 from public.curriculum_versions v where v.exam_id = e.id);

  insert into public.factory_exam_settings (exam_id, is_enabled)
  select e.id, true from public.exam_catalog e
  where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
  on conflict (exam_id) do nothing;

  insert into public.curriculum_sources (name, source_type, exam_id, priority)
  select 'ÖSYM Koçu master müfredat (' || e.name || ')', 'catalog_snapshot', e.id, 10
  from public.exam_catalog e
  where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
    and not exists (select 1 from public.curriculum_sources s where s.exam_id = e.id and s.source_type = 'catalog_snapshot');

  return jsonb_build_object('exams', 5);
end;
$$;

create or replace function public.admin_factory_exam_coverage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.sort_order)
    from (
      select
        e.id, e.code, e.name, e.sort_order,
        coalesce(f.is_enabled, true) as is_enabled,
        v.id as curriculum_version_id,
        v.status as curriculum_status,
        v.name as curriculum_name,
        (select count(*) from public.subject_catalog s where s.exam_id = e.id and s.is_active) as subjects,
        (select count(*) from public.topic_catalog t
           join public.unit_catalog u on u.id = t.unit_id
           join public.subject_catalog s on s.id = u.subject_id
           where s.exam_id = e.id and t.is_active and coalesce(u.code,'') = 'MASTER') as topics,
        (select count(*) from public.canonical_topic_segments g
           join public.exam_topic_map m on m.canonical_topic_id = g.canonical_topic_id
           where m.curriculum_version_id = v.id and m.included) as segments,
        (select count(*) from public.exam_topic_map m where m.curriculum_version_id = v.id and m.included) as mapped_topics,
        (
          select count(distinct m.canonical_topic_id)
          from public.exam_topic_map m
          join public.memory_lessons l on l.canonical_topic_id = m.canonical_topic_id
          where m.curriculum_version_id = v.id and m.included
            and l.status in ('approved', 'published', 'pending_validation')
        ) as lessons_ready,
        (
          select count(distinct q.canonical_topic_id)
          from public.exam_topic_map m
          join public.questions q on q.canonical_topic_id = m.canonical_topic_id
          where m.curriculum_version_id = v.id and m.included and q.question_status <> 'archived'
        ) as questions_ready,
        (select count(*) from public.content_generation_jobs j where j.exam_id = e.id and j.status = 'failed') as failed,
        (
          select count(*) from public.memory_lessons l
          join public.exam_topic_map m on m.canonical_topic_id = l.canonical_topic_id
          where m.curriculum_version_id = v.id and l.status = 'pending_validation'
        ) as pending_review
      from public.exam_catalog e
      left join public.factory_exam_settings f on f.exam_id = e.id
      left join lateral (select * from public.get_active_curriculum_version(e.id)) v on true
      where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Recreate sync wrapper to install master first; catalog snapshot is the locked taxonomy.
create or replace function public.curriculum_sync_internal(p_exam_id uuid default null, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev jsonb;
begin
  perform public.install_osymkocu_master_curriculum();
  v_prev := public.curriculum_sync_internal_scan(p_exam_id, p_force);
  return coalesce(v_prev, jsonb_build_object('unchanged', 0, 'proposals', 0, 'baselines_accepted', 0, 'needs_review', 0, 'ai_called', false, 'fetched_remote', false, 'master', 'OSYMKOCU_MASTER_2026_10_V1'));
end;
$$;

-- Keep previous scanner body under a new name by copying current 0058 function.

create or replace function public.curriculum_sync_internal_scan(p_exam_id uuid default null, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src record;
  v_hash text;
  v_exam uuid;
  v_unchanged int := 0;
  v_new int := 0;
  v_baseline int := 0;
  v_review int := 0;
  v_payload jsonb;
  v_cache public.curriculum_discovery_cache;
  v_issue text;
  v_has_accepted boolean;
  v_change text;
  v_status text;
  v_prev_hash text;
begin
  for v_src in
    select * from public.curriculum_sources
    where is_enabled and (p_exam_id is null or exam_id = p_exam_id)
  loop
    v_exam := v_src.exam_id;
    v_hash := public.catalog_curriculum_hash(v_exam);
    v_payload := jsonb_build_object('adapter', v_src.source_type, 'hash', v_hash, 'master', 'OSYMKOCU_MASTER_2026_10_V1');
    select * into v_cache
    from public.curriculum_discovery_cache
    where source_id = v_src.id and resource_identifier = 'catalog' and content_hash = v_hash
    order by fetched_at desc limit 1;

    update public.curriculum_sources
    set last_checked_at = now(), source_hash = v_hash, updated_at = now()
    where id = v_src.id;

    if v_src.source_type = 'catalog_snapshot' and exists (select 1 from public.curriculum_master_meta where id = 1) then
      insert into public.curriculum_discovery_cache (source_id, exam_id, resource_identifier, content_hash, normalized_payload, status, validated_at)
      values (v_src.id, v_exam, 'catalog', v_hash, v_payload, 'accepted', now())
      on conflict (source_id, resource_identifier, content_hash) do update
        set status = 'accepted', validated_at = coalesce(curriculum_discovery_cache.validated_at, now());
      v_unchanged := v_unchanged + 1;
      update public.curriculum_sources set last_success_at = now() where id = v_src.id;
      continue;
    end if;

    if v_cache.id is not null and v_cache.validated_at is not null and not coalesce(p_force, false) then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    insert into public.curriculum_discovery_cache (source_id, exam_id, resource_identifier, content_hash, normalized_payload, status)
    values (v_src.id, v_exam, 'catalog', v_hash, v_payload, 'cached')
    on conflict (source_id, resource_identifier, content_hash) do nothing;

    select exists (
      select 1 from public.curriculum_discovery_cache c where c.source_id = v_src.id and c.validated_at is not null
    ) into v_has_accepted;
    select c.content_hash into v_prev_hash
    from public.curriculum_discovery_cache c
    where c.source_id = v_src.id and c.validated_at is not null
    order by c.validated_at desc limit 1;
    v_issue := public.curriculum_first_snapshot_issues(v_exam, v_src.id);

    if not v_has_accepted then
      if v_issue is null then
        perform public.apply_curriculum_initial_baseline(v_exam, v_src.id, v_hash);
        v_baseline := v_baseline + 1;
        update public.curriculum_sources set last_success_at = now() where id = v_src.id;
        continue;
      end if;
      v_change := case v_issue when 'source_conflict' then 'SOURCE_CONFLICT' else 'AMBIGUOUS' end;
      v_status := 'needs_review';
    elsif v_prev_hash is null or v_prev_hash is not distinct from v_hash then
      v_unchanged := v_unchanged + 1;
      update public.curriculum_discovery_cache set status = 'accepted', validated_at = coalesce(validated_at, now())
      where source_id = v_src.id and content_hash = v_hash;
      update public.curriculum_sources set last_success_at = now() where id = v_src.id;
      continue;
    else
      v_change := 'UPDATED';
      v_status := 'needs_review';
      v_issue := coalesce(v_issue, 'structural_update');
    end if;

    insert into public.curriculum_change_proposals (exam_id, source_id, from_version_id, diff, status)
    select v_exam, v_src.id, (select id from public.get_active_curriculum_version(v_exam)),
           jsonb_build_object('result', v_change, 'change_type', v_change, 'hash', v_hash, 'reason', v_issue, 'auto_accepted', false),
           v_status
    where not exists (
      select 1 from public.curriculum_change_proposals p
      where p.exam_id = v_exam and p.diff->>'hash' = v_hash and p.status in ('draft', 'needs_review')
    );
    if found then
      v_new := v_new + 1;
      if v_status = 'needs_review' then v_review := v_review + 1; end if;
    end if;
    update public.curriculum_sources set last_success_at = now() where id = v_src.id;
  end loop;
  return jsonb_build_object('unchanged', v_unchanged, 'proposals', v_new, 'baselines_accepted', v_baseline, 'needs_review', v_review, 'ai_called', false, 'fetched_remote', false, 'master', 'OSYMKOCU_MASTER_2026_10_V1');
end;
$$;

select public.install_osymkocu_master_curriculum();
select public.install_osymkocu_master_curriculum();

update public.content_factory_settings
set production_enabled = false, engine_state = 'paused', last_idle_reason = 'paused', updated_at = now()
where id = 1;

grant execute on function public.install_osymkocu_master_curriculum() to authenticated;
grant execute on function public.install_osymkocu_master_curriculum() to service_role;
grant execute on function public.curriculum_sync_internal_scan(uuid, boolean) to service_role;
