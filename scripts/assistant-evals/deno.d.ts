// Khai báo tối thiểu để tsc (Node) kiểm mã cổng AI viết cho Deno.
declare namespace Deno {
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  const env: { get(name: string): string | undefined };
}
