update public.virtual_ai_budget_policy set enabled = true, updated_at = now() where id = 1;
select public.virtual_deterministic_social_tick() as second_tick;
select enabled from public.virtual_ai_budget_policy where id = 1;
select deterministic_social_only, virtual_social_enabled from public.virtual_student_engine_settings where id = 1;
