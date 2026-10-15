select task_type, primary_model, is_enabled
from public.ai_model_config
where task_type in ('bot_conversation','social_post_generation','social_comment_generation','lesson_generation','tts_generation')
order by task_type;
