export const SHARED_MATH_EXAMS = ["TYT", "KPSS_ORTAOGRETIM", "KPSS_ONLISANS", "KPSS_LISANS"] as const;
export const AYT_EXAM = "AYT";

export const MATH_HAP_RELATIONS: Record<string, string[]> = {
  "tek-cift-sayilar": ["Temel Kavramlar"],
  "isaret-kurallari": ["Temel Kavramlar"],
  "ardisik-sayi-ortalamasi": ["Temel Kavramlar", "Sayılar"],
  "birden-nye-toplam": ["Temel Kavramlar", "Sayılar"],
  "sayi-basamaklari": ["Sayı Basamakları"],
  "bolunebilme-2": ["Bölme ve Bölünebilme"],
  "bolunebilme-3": ["Bölme ve Bölünebilme"],
  "bolunebilme-4": ["Bölme ve Bölünebilme"],
  "bolunebilme-9": ["Bölme ve Bölünebilme"],
  "bolunebilme-5-10": ["Bölme ve Bölünebilme"],
  "asal-sayi-temeli": ["Asal Sayılar ve Asal Çarpanlara Ayırma", "Asal Sayılar ve Asal Çarpanlar"],
  "ebob": ["EBOB – EKOK"],
  "ekok": ["EBOB – EKOK"],
  "kesir-sadelestirme": ["Rasyonel Sayılar"],
  "kesirlerde-bolme": ["Rasyonel Sayılar"],
  "yuzde-hesabi": ["Problemler"],
  "yuzde-zam": ["Problemler"],
  "yuzde-indirim": ["Problemler"],
  "ardisik-yuzde": ["Problemler"],
  "oran-temeli": ["Oran – Orantı"],
  "dogru-oranti": ["Oran – Orantı"],
  "ters-oranti": ["Oran – Orantı"],
  "birinci-derece-denklem": ["Denklem Çözme", "Birinci Dereceden Denklemler"],
  "mutlak-deger": ["Mutlak Değer"],
  "uslu-carpma": ["Üslü Sayılar"],
  "uslu-bolme": ["Üslü Sayılar"],
  "sifirinci-kuvvet": ["Üslü Sayılar"],
  "kok-sadelestirme": ["Köklü Sayılar"],
  "aritmetik-ortalama": ["Temel Kavramlar", "Sayılar"],
  "yas-farki": ["Problemler"],
  "hiz-yol-zaman": ["Problemler"],
  "karsilikli-hareket": ["Problemler"],
  "ayni-yon-hareket": ["Problemler"],
  "isci-problemi-temel": ["Problemler"],
  "kar-yuzdesi": ["Problemler"],
  "zarar-yuzdesi": ["Problemler"],
  "karisim-yuzde": ["Problemler"],
  "kume-birlesim": ["Kümeler"],
  "kume-kesisim": ["Kümeler"],
  "olasilik-temel": ["Olasılık"],
  "permutasyon-mantigi": ["Permütasyon"],
  "kombinasyon-mantigi": ["Kombinasyon"],
  "tablo-sorusu-teknigi": ["Tablo ve Grafik Yorumlama", "Tablo ve Grafik"],
  "grafik-sorusu-teknigi": ["Tablo ve Grafik Yorumlama", "Tablo ve Grafik"],
  "sayisal-mantik-tablo": ["Sayısal Mantık", "Mantık"],
  "dogru-aci": ["Doğruda Açılar", "Açılar"],
  "ters-acilar": ["Doğruda Açılar", "Açılar"],
  "ucgen-ic-aci": ["Üçgende Açılar", "Üçgenler"],
  "pisagor": ["Dik Üçgen", "Üçgenler"],
  "ucgen-alani": ["Üçgende Alan"],
  "dikdortgen-alani": ["Dikdörtgen", "Dörtgenler"],
  "kare-alani": ["Kare", "Dörtgenler"],
  "daire-alani": ["Çember ve Daire"],
  "daire-cevresi": ["Çember ve Daire"],
};

export const COVERAGE_TOPICS = [
  "Faktöriyel",
  "Asal Çarpanlara Ayırma",
  "Ondalıklı Sayılar",
  "Basit Eşitsizlikler",
  "Çarpanlara Ayırma",
  "Fonksiyon Temeli",
  "Modüler Aritmetik",
  "Sayı Problemleri",
  "Kesir Problemleri",
  "Faiz Problemleri",
  "Havuz Problemleri",
  "Sayısal Mantık",
  "Çokgenler",
  "Dörtgenler",
  "Çember temel bilgileri",
];

export function foldName(value: string) {
  return value
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıIİi]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
