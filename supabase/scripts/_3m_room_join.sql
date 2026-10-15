select public.virtual_ensure_study_room('b0000000-0000-4000-8000-000000000002') as mert_join;
select public.virtual_ensure_study_room('b0000000-0000-4000-8000-000000000001') as elif_chat;

update public.exam_chat_room_state set next_eligible_at = clock_timestamp() where slug in ('tyt','ayt','kpss');
select public.pulse_exam_chats() as p1;
select public.pulse_exam_chats() as p2;
select public.pulse_exam_chats() as p3;
select public.pulse_exam_chats() as p4;
