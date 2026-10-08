import { json, mapHttpError, requireLessonAdmin, serviceClient } from "../_shared/lessonHttp.ts";

const EXAMS = new Set(["tyt", "ayt", "kpss"]);

function foldTr(value: string) {
  return value
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıIİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/[âÂ]/g, "a")
    .replace(/[îÎ]/g, "i")
    .replace(/[ûÛ]/g, "u");
}

function slugify(value: string) {
  const base = foldTr(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return base || "ders";
}

function cleanText(value: unknown, max = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function mapExamType(code: string) {
  const upper = code.trim().toUpperCase();
  if (upper === "TYT" || upper.startsWith("TYT")) return "tyt";
  if (upper === "AYT" || upper.startsWith("AYT")) return "ayt";
  if (upper.startsWith("KPSS")) return "kpss";
  return "";
}

async function uniqueSlug(admin: ReturnType<typeof serviceClient>, title: string) {
  const root = slugify(title);
  for (let i = 0; i < 12; i += 1) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    const { data } = await admin.from("memory_lessons").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${root}-${crypto.randomUUID().slice(0, 8)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") {
    return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);
  }

  try {
    await requireLessonAdmin(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const payload = (body?.payload ?? body ?? {}) as Record<string, unknown>;
    const admin = serviceClient();

    const topicId = cleanText(payload.topic_id, 40);
    const unitId = cleanText(payload.unit_id, 40);
    const subjectId = cleanText(payload.subject_id, 40);
    const examId = cleanText(payload.exam_id, 40);

    let examType = cleanText(payload.exam_type, 12).toLowerCase();
    let subject = cleanText(payload.subject, 80);
    let unit = cleanText(payload.unit, 120);
    let topic = cleanText(payload.topic, 160);
    let title = cleanText(payload.title, 160);
    let resolvedExamId: string | null = null;
    let resolvedSubjectId: string | null = null;
    let resolvedUnitId: string | null = null;
    let resolvedTopicId: string | null = null;
    let canonicalTopicId: string | null = null;
    const lessonScope = cleanText(payload.lesson_scope, 32) || "core";
    const coverageDepth = cleanText(payload.coverage_depth, 16) || "standard";
    const usageMode = cleanText(payload.usage_mode, 32) || "core";
    const baseLessonId = cleanText(payload.base_lesson_id, 40) || null;

    if (topicId) {
      const { data: topicRow } = await admin
        .from("topic_catalog")
        .select("id, name, unit_id, canonical_topic_id")
        .eq("id", topicId)
        .maybeSingle();
      if (!topicRow) {
        return json({ error: { code: "INVALID_INPUT", message: "Konu bulunamadı." } }, 400);
      }
      const { data: unitRow } = await admin.from("unit_catalog").select("id, name, subject_id").eq("id", topicRow.unit_id).maybeSingle();
      if (!unitRow) {
        return json({ error: { code: "INVALID_INPUT", message: "Ünite bulunamadı." } }, 400);
      }
      const { data: subjectRow } = await admin.from("subject_catalog").select("id, name, exam_id").eq("id", unitRow.subject_id).maybeSingle();
      if (!subjectRow) {
        return json({ error: { code: "INVALID_INPUT", message: "Ders bulunamadı." } }, 400);
      }
      const { data: examRow } = await admin.from("exam_catalog").select("id, code, name").eq("id", subjectRow.exam_id).maybeSingle();
      if (!examRow) {
        return json({ error: { code: "INVALID_INPUT", message: "Sınav bulunamadı." } }, 400);
      }
      if ((unitId && unitRow.id !== unitId) || (subjectId && subjectRow.id !== subjectId) || (examId && examRow.id !== examId)) {
        return json({ error: { code: "INVALID_INPUT", message: "Müfredat hiyerarşisi uyuşmuyor." } }, 400);
      }
      resolvedTopicId = topicRow.id;
      resolvedUnitId = unitRow.id;
      resolvedSubjectId = subjectRow.id;
      resolvedExamId = examRow.id;
      canonicalTopicId = topicRow.canonical_topic_id ? String(topicRow.canonical_topic_id) : null;
      topic = topicRow.name;
      unit = unitRow.name;
      subject = subjectRow.name;
      examType = mapExamType(examRow.code);
      if (!title) title = topicRow.name;
    }

    if (!EXAMS.has(examType) || !subject || !unit || !topic || !title) {
      return json({ error: { code: "INVALID_INPUT", message: "Sınav, ders, ünite, konu ve başlık gerekli." } }, 400);
    }

    const slug = await uniqueSlug(admin, title);
    const { data, error } = await admin
      .from("memory_lessons")
      .insert({
        exam_type: examType,
        subject,
        unit,
        topic,
        title,
        slug,
        status: "draft",
        version: 1,
        exam_id: resolvedExamId,
        subject_id: resolvedSubjectId,
        unit_id: resolvedUnitId,
        topic_id: resolvedTopicId,
        canonical_topic_id: canonicalTopicId,
        lesson_scope: ["core", "exam_extension", "exam_specific"].includes(lessonScope) ? lessonScope : "core",
        coverage_depth: ["basic", "standard", "advanced"].includes(coverageDepth) ? coverageDepth : "standard",
        base_lesson_id: baseLessonId,
      })
      .select("*")
      .single();

    if (error || !data) {
      return json({ error: { code: "PROVIDER_ERROR", message: "Ders oluşturulamadı." } }, 500);
    }

    if (resolvedExamId && canonicalTopicId) {
      const { data: version } = await admin.rpc("get_active_curriculum_version", { p_exam_id: resolvedExamId });
      const versionRow = Array.isArray(version) ? version[0] : version;
      const versionId = versionRow && typeof versionRow === "object" ? String((versionRow as { id?: string }).id ?? "") : "";
      if (versionId) {
        await admin.from("memory_lesson_exam_map").upsert(
          {
            lesson_id: data.id,
            curriculum_version_id: versionId,
            canonical_topic_id: canonicalTopicId,
            usage_mode: ["core", "core_plus_extension", "exam_specific"].includes(usageMode) ? usageMode : "core",
            is_active: true,
          },
          { onConflict: "lesson_id,curriculum_version_id" },
        );
      }
    }

    return json({ lesson: data });
  } catch (error) {
    return mapHttpError(error);
  }
});
