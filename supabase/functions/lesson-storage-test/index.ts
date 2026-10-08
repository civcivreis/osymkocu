import { json, mapHttpError, preflight, requireLessonAdmin } from "../_shared/lessonHttp.ts";
import { deleteLessonObject, lessonR2Bucket, putLessonObject } from "../_shared/lessonR2.ts";

const TEST_KEY = "lessons/_test/connection-test.txt";
const TEST_BODY = "ÖSYM Koçu lesson storage working";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") {
    return json({ error: { code: "INVALID_INPUT", message: "POST gerekli." } }, 405);
  }

  try {
    await requireLessonAdmin(req);
    await putLessonObject(TEST_KEY, TEST_BODY, "text/plain; charset=utf-8");
    let cleaned = false;
    try {
      await deleteLessonObject(TEST_KEY);
      cleaned = true;
    } catch {
      cleaned = false;
    }
    return json({
      success: true,
      key: TEST_KEY,
      bucket: lessonR2Bucket(),
      cleaned,
    });
  } catch (error) {
    return mapHttpError(error, req);
  }
});
