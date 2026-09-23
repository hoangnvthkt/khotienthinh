import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardList, ShoppingCart } from 'lucide-react';

interface Props {
  area: 'project' | 'procurement';
}

const V2FoundationNotice: React.FC<Props> = ({ area }) => {
  const project = area === 'project';
  const Icon = project ? ClipboardList : ShoppingCart;
  const title = project ? 'Không gian Dự án V2' : 'Hồ sơ Mua hàng V2';
  const currentRoute = project ? '/da' : '/procurement';
  const currentLabel = project ? 'Dự án' : 'Mua hàng';
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
          <Icon aria-hidden="true" size={24} />
        </div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">Phiên bản thử nghiệm</p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Không gian này chưa được kích hoạt cho dự án của bạn. Dữ liệu và thao tác hiện tại vẫn ở phiên bản đang sử dụng.
        </p>
        <Link to={currentRoute} className="mt-7 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft aria-hidden="true" size={16} /> Mở {currentLabel}
        </Link>
      </section>
    </main>
  );
};

export default V2FoundationNotice;
