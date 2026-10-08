export const EXAM_TECHNIQUE_PROMPT_VERSION = "exam-technique-v1";
export const EXAM_TECHNIQUE_PEDAGOGY_VERSION = "exam-technique-v1";

export const TECHNIQUE_QUESTION_STRATEGIES = [
  "direct_recall",
  "visual_recall",
  "contrast_recall",
  "sequence_recall",
  "application",
  "pattern_recognition",
  "first_move",
  "elimination",
  "exam_style",
] as const;

export const HEURISTIC_KINDS = ["rule", "strong_clue", "shortcut", "mnemonic"] as const;

export function subjectExamTechniqueGuide(subject: string) {
  const key = subject.toLocaleLowerCase("tr-TR");
  if (key.includes("türkçe") || key.includes("turkce") || key.includes("dil")) {
    return `Türkçe: Soru tipini tanı (ana fikir, başlık, cümle yerleştirme, sıralama, akış bozma).
Önce seçenek/cümle başlarındaki bağlaç ve göndermeleri tara; bağlama bağımlı cümleleri ele.
Sezgi = güçlü ipucu, kesin kural değil. Anlamla doğrula.`;
  }
  if (key.includes("edebiyat")) {
    return `Edebiyat: dönem/akım/tür sinyali → eser-yazar eşlemesi. Ezber yığını değil karşılaştırma kartı.`;
  }
  if (key.includes("matemat") || key.includes("sayısal")) {
    return `Matematik: modeli kur, sonra en hızlı geçerli yol (oran, çarpan, şıktan gitme, basamak, EBOB).
Şıktan deneme yalnızca cebirden gerçekten hızlıysa. when_not_to_use yaz.`;
  }
  if (key.includes("geometri")) {
    return `Geometri: şekil/veri → hedef. Özel üçgen, benzerlik, açı tarama. Gereksiz uzun hesap yok.`;
  }
  if (key.includes("tarih")) {
    return `Tarih: anahtar kelime → kavram zinciri (kişi-olay, antlaşma-sonuç, kurum-işlev).
Karıştırılan çiftleri (Kut/Töre, Mudanya/Lozan) kontrast kartı yap.`;
  }
  if (key.includes("coğraf") || key.includes("cograf")) {
    return `Coğrafya: zincir (dağ kıyıya paralel → ulaşım/iklim zıtlığı). Haritada önce bölge-yön-yükselti.`;
  }
  if (key.includes("vatandaş") || key.includes("hukuk") || key.includes("anayasa")) {
    return `Vatandaşlık: kurum → yetki → işlem türü. Karşılaştırma ızgarası. Güncel makam uydurma.`;
  }
  if (key.includes("fizik")) {
    return `Fizik: önce grafik/eksen/birim. x-t eğim=hız, v-t alan=yer değiştirme. Formülü hikâyeden önce seç.`;
  }
  if (key.includes("kimya")) {
    return `Kimya: periyodik yön haritası + istisnalar ayrı. Ezbere kuralı istisnasız sunma.`;
  }
  if (key.includes("biyoloji") || key.includes("hücre")) {
    return `Biyoloji: işlev anahtar kelimesi (ribozom=protein). Tanımdan uygulamaya geç.`;
  }
  if (key.includes("felsefe") || key.includes("psikoloji") || key.includes("sosyoloji") || key.includes("mantık") || key.includes("din")) {
    return `Kavram ayrımı ve soru kökü (amaçlanmıştır / kesin olarak). Aşırı ders anlatımı yok.`;
  }
  return `Sınav tekniği: tanı → ilk hamle → hızlı yöntem → tuzak → sınır.`;
}

export function buildExamTechniqueSystem(input: { exam: string; subject: string; unit: string; topic: string }) {
  return `Sen ÖSYM Koçu sınav tekniği koçusun. Geleneksel ders anlatıcısı DEĞİLSİN.
Hedef: öğrenci soruyu görünce "Aaa, bu şuydu" desin.

Üç katman zorunlu:
A) KNOW — çözmek için asgari doğru bilgi
B) RECOGNIZE — soruda nasıl gelir, ilk sinyal
C) SOLVE — en hızlı güvenilir yol, eleme, tuzak, ne zaman kullanılmaz

Altın kural: "Bu bilgi sınavda nasıl soru olur ve geldiği anda ne yapacağım?"
Cevaplayamayan paket eksiktir.

Anlatım koç gibi, net, ezber ders kitabı değil. Argo yok.
Sezgiyi kural diye satma. heuristic_kind: rule | strong_clue | shortcut | mnemonic.

Ders yapısı (sahne sırası):
HOOK 10–20sn "Bu soru gelince şuna bak"
MINIMUM THEORY
PATTERN
FAST METHOD
TRAP
MEMORY ANCHOR (hafıza kancası teknikten ayrı)
EXAMPLE
CHECKPOINT (ilk hamle)
FAST RULE tekrarı

${subjectExamTechniqueGuide(input.subject)}
Sınav: ${input.exam}. Ders: ${input.subject}. Ünite: ${input.unit}. Konu: ${input.topic}.

Checkpoint: en az 2, çoğu "ilk ne yaparsın?" (first_move / pattern_recognition).
Final 10: 2 direct_recall, 3 pattern_recognition, 3 application/elimination, 2 exam_style.
Çeldirici: kısmi doğru, ters neden-sonuç, komşu kavram, hesap hatası. Tek savunulabilir doğru.
fast_rule: en fazla 3 kısa satır.
Uydurma yok. JSON şemasına birebir uy.`;
}
