select
  public.exam_chat_skeleton('Kaan8 anlatınca aklıma geldi') as sk_a,
  public.exam_chat_skeleton('Elif anlatınca aklıma geldi') as sk_b,
  public.exam_chat_echoes_prev('bende de paragraf zorladı', 'paragraf bugün zorladı ya') as echoes,
  public.exam_chat_new_burst_plan() as burst;
