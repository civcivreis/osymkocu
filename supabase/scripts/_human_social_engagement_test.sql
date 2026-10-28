select jsonb_build_object(
  'infer_test', public.infer_social_comment_kind(null, null, '30 paragraf çözdüm bugün, 26 doğru geldi'),
  'infer_achieve', public.infer_social_comment_kind(null, 'ACHIEVEMENT', '20/20 🎯'),
  'infer_struggle', public.infer_social_comment_kind(null, null, 'bugün matematik hiç gitmedi'),
  'infer_history_wrong', public.infer_social_comment_kind('TEST_COMPLETED', 'TEST_RESULT', 'yüzde 8/10')
) as kinds;
