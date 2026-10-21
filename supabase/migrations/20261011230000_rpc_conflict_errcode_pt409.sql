-- Sự cố 10–11/10/2026: ~8,6 triệu lỗi ROW_VERSION_CONFLICT (100 lần/giây suốt ~17 giờ).
--
-- Các RPC báo xung đột phiên bản (dữ liệu trên màn hình đã cũ) bằng SQLSTATE 40001
-- (serialization_failure). PostgREST coi 40001 là lỗi tạm thời và tự chạy lại giao dịch;
-- nhưng xung đột phiên bản là tất định — expectedRowVersion của client không đổi — nên
-- vòng chạy lại không bao giờ dừng, chiếm một kết nối và người dùng chờ tới timeout.
--
-- Sửa: mọi `errcode = '40001'` do ứng dụng tự raise đổi thành 'PT409'. PostgREST trả
-- HTTP 409, code 'PT409', giữ nguyên message (ROW_VERSION_CONFLICT, CONFLICT, ...).
-- Các hàm bọc đang bắt serialization_failure (Quy trình, Nhật ký) vốn chỉ đổi 40001 -> PT409
-- với cùng message, nên kết quả trả về client không đổi. Handler của chúng vẫn giữ để bắt
-- serialization_failure thật của Postgres.
--
-- Viết lại động từ pg_get_functiondef để phủ đúng định nghĩa hiện hành (không chép tay
-- ~100 hàm). Migration mới không được raise 40001: xem lib/__tests__/rpcConflictErrcode.test.ts.

do $migration$
declare
  r record;
  v_def text;
  v_new text;
  v_count integer := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname in ('public', 'app_private')
      and l.lanname = 'plpgsql'
      and p.prosrc ~* $re$errcode\s*=\s*'40001'$re$
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, $re$(errcode\s*=\s*)'40001'$re$, $rep$\1'PT409'$rep$, 'gi');
    if v_new = v_def then
      raise exception 'PT409 rewrite made no change for %', r.signature;
    end if;
    execute v_new;
    v_count := v_count + 1;
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and p.prosrc ~* $re$(errcode\s*=\s*|sqlstate\s+)'40001'$re$
  ) then
    raise exception 'functions still raise SQLSTATE 40001 after PT409 rewrite';
  end if;

  raise notice 'rewrote % functions from errcode 40001 to PT409', v_count;
end
$migration$;
