import { redirect } from 'next/navigation';

// 旧URL。ブックマーク向けに税金画面へ転送する
export default function TaxSimulationRedirect() {
  redirect('/tax');
}
