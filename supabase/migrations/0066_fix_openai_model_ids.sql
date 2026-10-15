-- Invalid OpenAI IDs (gpt-6.1-sol / gpt-6-luna) caused lesson_generation AI_PROVIDER.
-- Map to documented Chat Completions models. Do not enable the factory motor.

update public.ai_model_config
set
  primary_model = case primary_model
    when 'gpt-6.1-sol' then 'gpt-5.6-sol'
    when 'gpt-6-sol' then 'gpt-5.6-sol'
    when 'gpt-6-luna' then 'gpt-5.6-luna'
    else primary_model
  end,
  fallback_model = case fallback_model
    when 'gpt-6.1-sol' then 'gpt-5.6-sol'
    when 'gpt-6-sol' then 'gpt-5.6-sol'
    when 'gpt-6-luna' then 'gpt-5.6-luna'
    else fallback_model
  end,
  economy_model = case economy_model
    when 'gpt-6.1-sol' then 'gpt-5.6-sol'
    when 'gpt-6-sol' then 'gpt-5.6-sol'
    when 'gpt-6-luna' then 'gpt-5.6-luna'
    else economy_model
  end,
  premium_model = case premium_model
    when 'gpt-6.1-sol' then 'gpt-6-astra'
    when 'gpt-6-sol' then 'gpt-6-astra'
    when 'gpt-6-luna' then 'gpt-5.6-luna'
    else premium_model
  end,
  max_output_tokens = case
    when task_type = 'lesson_generation' then greatest(coalesce(max_output_tokens, 0), 16000)
    else max_output_tokens
  end,
  updated_at = now()
where primary_model in ('gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna')
   or fallback_model in ('gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna')
   or economy_model in ('gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna')
   or premium_model in ('gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna')
   or task_type = 'lesson_generation';

update public.ai_runtime_settings
set mode = 'balanced', updated_at = now()
where id = 1 and mode = 'premium';

update public.content_factory_settings
set production_enabled = false,
    engine_state = 'paused',
    updated_at = now()
where id = 1;
