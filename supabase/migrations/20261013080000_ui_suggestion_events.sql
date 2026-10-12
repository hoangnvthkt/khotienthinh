-- Gợi ý in mờ (chủ SP 11/10/2026): đo tỷ lệ người dùng nhận / bỏ / sửa gợi ý điền sẵn trên từng màn.
--   * ui_suggestion_events: một dòng mỗi lần nhận hoặc bỏ gợi ý — màn, nhóm ô, kết quả, số dòng gợi ý / giữ nguyên.
--   * Người dùng chỉ ghi dòng của mình; Admin đọc để tính tỷ lệ theo màn. Không ghi nội dung chứng từ, chỉ id nguồn.

create table if not exists public.ui_suggestion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.current_app_user_id() references public.users(id) on delete cascade,
  screen text not null,
  field text not null,
  outcome text not null check (outcome in ('accepted', 'dismissed', 'edited')),
  suggested integer not null default 0 check (suggested >= 0),
  accepted integer not null default 0 check (accepted >= 0),
  source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),
  created_at timestamptz not null default now()
);
comment on table public.ui_suggestion_events is 'Gợi ý in mờ: người dùng nhận / bỏ / sửa gợi ý điền sẵn — đo tỷ lệ dùng theo màn.';
create index if not exists ui_suggestion_events_screen_idx on public.ui_suggestion_events (screen, created_at desc);

alter table public.ui_suggestion_events enable row level security;
create policy ui_suggestion_events_insert on public.ui_suggestion_events for insert to authenticated
  with check (user_id = public.current_app_user_id());
create policy ui_suggestion_events_select on public.ui_suggestion_events for select to authenticated
  using (public.is_admin());
grant select, insert on public.ui_suggestion_events to authenticated;
