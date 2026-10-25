import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Clock3, ExternalLink, MessageCircleQuestion, Radar, Scale } from 'lucide-react';
import { api } from './api';

type Language = 'ru' | 'en';
type Concern = 'price' | 'resources' | 'network' | 'support';
type Plan = {
  id: string; name: string; price_rub: number; cpu: number; ram_gb: number; disk_gb: number;
  disk_type: string; cpu_class: string | null; billing: string; location: string | null;
  native_price_rub?: number; ipv4_extra_rub?: number; os_family?: string; traffic_tb?: number | null;
};
type Provider = { id: string; name: string; source_url: string; fetched_at: string | null; stale: boolean; error: string | null; plans: Plan[] };
type Catalog = { refresh_interval_hours: number; providers: Provider[] };
const rub = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })} ₽`;
const date = (value: string | null, ru: boolean) => value ? new Date(value).toLocaleString(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : (ru ? 'нет данных' : 'no data');
const total = (p: Plan, ipv4: boolean) => p.price_rub + (ipv4 ? p.ipv4_extra_rub || 0 : 0);

function compare(base: Plan, rival: Plan, ru: boolean, ipv4: boolean) {
  const strengths: string[] = [], caveats: string[] = [];
  const delta = total(rival, ipv4) - total(base, ipv4);
  if (delta > 0.01) strengths.push(ru ? `Aéza дешевле на ${rub(delta)} за сравниваемый период.` : `Aéza costs ${rub(delta)} less for the compared period.`);
  if (delta < -0.01) caveats.push(ru ? `Конкурент дешевле на ${rub(-delta)} за сравниваемый период.` : `The competitor costs ${rub(-delta)} less for the compared period.`);
  const resource = (label: string, a: number, b: number, unit: string) => {
    if (a > b) strengths.push(ru ? `У Aéza на ${a - b} ${unit} больше ${label}.` : `Aéza has ${a - b} more ${unit} ${label}.`);
    if (a < b) caveats.push(ru ? `У конкурента на ${b - a} ${unit} больше ${label}.` : `The competitor has ${b - a} more ${unit} ${label}.`);
  };
  resource('vCPU', base.cpu, rival.cpu, '');
  resource('RAM', base.ram_gb, rival.ram_gb, ru ? 'ГБ' : 'GB');
  resource(ru ? 'диска' : 'disk', base.disk_gb, rival.disk_gb, ru ? 'ГБ' : 'GB');
  if (base.disk_type !== rival.disk_type) caveats.push(ru ? `Накопители разного типа: ${base.disk_type} и ${rival.disk_type}; объём не показывает скорость.` : `Storage types differ: ${base.disk_type} and ${rival.disk_type}; capacity does not establish speed.`);
  if (base.cpu_class !== rival.cpu_class) caveats.push(ru ? 'Тип CPU может отличаться: выделенный и общий vCPU нельзя считать равными по производительности.' : 'CPU class may differ: dedicated and shared vCPU are not performance equivalents.');
  if (rival.billing === 'daily_30_day_equivalent') caveats.push(ru ? 'Цена Selectel пересчитана из посуточной ставки за 30 дней; фактический платёж зависит от числа дней.' : 'Selectel price is 30 days at the daily rate; actual cost depends on days used.');
  if (rival.os_family === 'Windows') caveats.push(ru ? 'У конкурента тариф Windows, а выбранный тариф Aéza сравнивается без стоимости лицензии ОС.' : 'The rival plan is Windows; the selected Aéza plan is compared without an OS licence cost.');
  if (ipv4 && rival.ipv4_extra_rub) caveats.push(ru ? `Для публичного IPv4 у конкурента добавлено ${rub(rival.ipv4_extra_rub)} за месяц.` : `${rub(rival.ipv4_extra_rub)} per month was added for the rival's public IPv4.`);
  if (!strengths.length) strengths.push(ru ? 'По проверенным числам преимущества Aéza в этой паре нет.' : 'No Aéza advantage in the verified numbers for this pair.');
  let verdict: string;
  if (delta >= 0 && (base.ram_gb >= rival.ram_gb || base.disk_gb >= rival.disk_gb)) {
    verdict = ru ? `Aéza можно рекомендовать: итоговая цена ${rub(total(base, ipv4))} против ${rub(total(rival, ipv4))}, при этом есть не меньший объём RAM или диска.` : `Aéza is a reasonable offer: ${rub(total(base, ipv4))} versus ${rub(total(rival, ipv4))}, with at least as much RAM or disk.`;
  } else if (base.ram_gb > rival.ram_gb || base.disk_gb > rival.disk_gb) {
    verdict = ru ? `Aéza стоит предлагать клиенту, которому важнее запас ресурсов: RAM ${base.ram_gb} против ${rival.ram_gb} ГБ, диск ${base.disk_gb} против ${rival.disk_gb} ГБ. Согласуйте доплату ${rub(Math.max(0, -delta))}.` : `Offer Aéza when extra capacity matters: RAM ${base.ram_gb} vs ${rival.ram_gb} GB, disk ${base.disk_gb} vs ${rival.disk_gb} GB. Discuss the ${rub(Math.max(0, -delta))} premium.`;
  } else {
    verdict = ru ? 'По опубликованной цене и ресурсам преимуществ Aéza нет. Уточните требования клиента и предложите проверяемый тест, не обещая превосходства без данных.' : 'Published price and capacity do not show an Aéza advantage. Ask about needs and offer a measurable trial without unsupported superiority claims.';
  }
  return { strengths, caveats, verdict };
}

const concernNames: Record<Concern, { ru: string; en: string }> = {
  price: { ru: 'Стоимость', en: 'Price' }, resources: { ru: 'Ресурсы', en: 'Capacity' },
  network: { ru: 'Сеть и IP', en: 'Network & IP' }, support: { ru: 'Поддержка', en: 'Support' },
};
function customerResponse(provider: Provider, rival: Plan, concern: Concern, ru: boolean, ipv4: boolean): { text: string; url: string } {
  if (concern === 'price') return { text: ru ? 'Спросите, какая сумма получается с нужными опциями и на какой срок. Сравните итоговую цену выше; скидки за длительную предоплату не смешиваются с месячным тарифом.' : 'Ask for the total with required options and the billing term. Use the total above; do not mix long prepayment discounts with monthly prices.', url: provider.source_url };
  if (concern === 'resources') return { text: ru ? `Уточните реальные требования по CPU, RAM и диску. Для ${rival.name} опубликованы ${rival.cpu} vCPU, ${rival.ram_gb} ГБ RAM и ${rival.disk_gb} ГБ диска; сравните их с выбранным тарифом Aéza.` : `Ask what CPU, RAM and disk the customer needs. ${rival.name} publishes ${rival.cpu} vCPU, ${rival.ram_gb} GB RAM and ${rival.disk_gb} GB storage. Compare with Aéza above.`, url: provider.source_url };
  if (concern === 'support') return { text: ru ? 'Если клиент столкнулся со сбоем или медленным ответом, попросите номер обращения, время и ожидаемый результат. Обещайте только проверяемый план решения и тест сервиса; по тарифной странице качество поддержки не измерить.' : 'If the customer reports an outage or slow response, ask for the ticket, time and expected outcome. Offer a measurable resolution plan and service trial; a pricing page does not measure support quality.', url: provider.source_url };
  if (provider.id === 'selectel' && rival.traffic_tb) return { text: ru ? `Если клиента беспокоит трафик: Selectel публикует ${rival.traffic_tb} ТБ внешнего трафика в месяц и плату за превышение; Aéza указывает безлимитный трафик. Уточните фактическое потребление и условия обоих тарифов.` : `For traffic concerns: Selectel publishes ${rival.traffic_tb} TB of monthly external traffic and overage fees; Aéza lists unlimited traffic. Check usage and both terms.`, url: provider.source_url };
  if (provider.id === 'beget') return { text: ru ? `Если нужен публичный IPv4, Beget указывает отдельную плату ${rub(rival.ipv4_extra_rub || 0)} в месяц, Aéza публикует один IPv4 в тарифе. ${ipv4 ? 'Доплата уже включена в сравнение выше.' : 'Включите переключатель IPv4 для полного расчёта.'}` : `If public IPv4 is needed, Beget lists an extra ${rub(rival.ipv4_extra_rub || 0)} per month; Aéza lists one included IPv4. ${ipv4 ? 'The extra is included in the comparison above.' : 'Enable IPv4 for a full comparison.'}`, url: 'https://beget.com/ru/kb/manual/ipv4-kupit-v-oblake' };
  if (provider.id === 'ruvds' && rival.id === 'ruvds-1') return { text: ru ? 'У тарифа RUVDS «Старт» на официальной странице указаны ограничения. Узнайте, какие из них мешают клиенту, и сравните с условиями Aéza; не переносите это утверждение на другие тарифы RUVDS.' : 'RUVDS lists restrictions for its Start plan. Ask which ones affect the customer and check Aéza terms; do not extend the claim to other RUVDS plans.', url: provider.source_url };
  return { text: ru ? 'Уточните, что именно не устроило клиента: скорость, трафик или IP. Проверьте условия и предложите тест на реальной нагрузке; по тарифной странице нельзя доказать качество соединения.' : 'Ask whether the concern is speed, traffic or IP. Check terms and offer a test with real workload; the pricing page alone cannot establish network quality.', url: provider.source_url };
}

export function CompetitorRadar({ language }: { language: Language }) {
  const ru = language === 'ru';
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [baseId, setBaseId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [rivalId, setRivalId] = useState('');
  const [concern, setConcern] = useState<Concern>('price');
  const [ipv4, setIpv4] = useState(true);
  useEffect(() => {
    let active = true;
    const load = () => api<Catalog>('/competitors/tariffs').then(data => { if (active) { setCatalog(data); setError(''); } }).catch(e => { if (active) setError(e.message); });
    load();
    const timer = window.setInterval(load, 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const aeza = catalog?.providers.find(p => p.id === 'aeza');
  const competitors = catalog?.providers.filter(p => p.id !== 'aeza') || [];
  const company = competitors.find(p => p.id === companyId) || competitors.find(p => p.plans.length) || competitors[0];
  const base = aeza?.plans.find(p => p.id === baseId) || aeza?.plans[0];
  const rival = company?.plans.find(p => p.id === rivalId) || company?.plans[0];
  const analysis = useMemo(() => base && rival ? compare(base, rival, ru, ipv4) : null, [base, rival, ru, ipv4]);
  const response = company && rival ? customerResponse(company, rival, concern, ru, ipv4) : null;
  return <div className="radar-page">
    <section className="radar-summary-grid">
      <article className="panel radar-kpi accent"><Radar/><span>{ru ? 'Компаний' : 'Providers'}</span><strong>{catalog?.providers.filter(p => p.plans.length).length ?? '—'}</strong><small>{ru ? 'Официальные источники' : 'Official sources'}</small></article>
      <article className="panel radar-kpi"><Scale/><span>{ru ? 'Готовых тарифов' : 'Fixed plans'}</span><strong>{catalog?.providers.reduce((sum, p) => sum + p.plans.length, 0) ?? '—'}</strong><small>{ru ? 'С ценой и ресурсами' : 'With price and resources'}</small></article>
      <article className="panel radar-kpi"><Clock3/><span>{ru ? 'Обновление' : 'Refresh'}</span><strong>72 ч</strong><small>{ru ? 'Проверка раз в 3 дня' : 'Checked every 3 days'}</small></article>
    </section>
    {error && <div className="panel radar-status" role="alert">{ru ? 'Не удалось загрузить каталог: ' : 'Could not load catalog: '}{error}</div>}
    {catalog?.providers.some(p => p.stale || p.error) && <div className="panel radar-status" role="status">{ru ? 'Часть источников недоступна или данные старше трёх дней. Смотрите дату проверки рядом с компанией.' : 'Some sources are unavailable or older than three days. Check each provider’s verification date.'}</div>}
    <section className="panel comparison-builder"><div className="panel-heading"><div><h2>{ru ? 'Сравнить тарифы' : 'Compare plans'}</h2><p>{ru ? 'Слева Aéza, справа компания и её тариф. Для Selectel показан эквивалент 30 дней.' : 'Aéza on the left, provider and plan on the right. Selectel shows a 30-day equivalent.'}</p></div></div>
      <label className="radar-ipv4-toggle"><input type="checkbox" checked={ipv4} onChange={e => setIpv4(e.target.checked)}/><span>{ru ? 'Нужен публичный IPv4: учитывать известную доплату' : 'Public IPv4 needed: include known extra charge'}</span></label>
      <div className="radar-picker-grid">
        <div className="radar-picker-side radar-aeza-side"><div className="radar-side-heading"><span>Aéza</span><a href={aeza?.source_url} target="_blank" rel="noreferrer">{ru ? 'Источник' : 'Source'} <ExternalLink size={14}/></a></div><label>{ru ? 'Тариф Aéza' : 'Aéza plan'}<div className="select-shell"><select value={base?.id || ''} onChange={e => setBaseId(e.target.value)}>{aeza?.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown/></div></label><Freshness provider={aeza} ru={ru}/>{base && <PlanCard plan={base} ru={ru} ipv4={ipv4}/>}</div>
        <div className="radar-picker-side"><div className="radar-side-heading"><span>{ru ? 'Конкуренты' : 'Competitors'}</span></div><div className="radar-company-tabs" role="group" aria-label={ru ? 'Выбрать компанию' : 'Choose provider'}>{competitors.map(p => <button key={p.id} type="button" className={company?.id === p.id ? 'selected' : ''} onClick={() => { setCompanyId(p.id); setRivalId(''); }}>{p.name}<small>{p.plans.length}</small></button>)}</div>{company && <><label>{ru ? `Тариф ${company.name}` : `${company.name} plan`}<div className="select-shell"><select value={rival?.id || ''} onChange={e => setRivalId(e.target.value)}>{company.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown/></div></label><Freshness provider={company} ru={ru}/>{rival && <PlanCard plan={rival} ru={ru} ipv4={ipv4}/>}</>}</div>
      </div>
      {base && rival && <div className="comparison-table" role="table">{[
        [ru ? 'Цена / период' : 'Price / period', rub(total(base, ipv4)), rub(total(rival, ipv4))],
        ['vCPU', String(base.cpu), String(rival.cpu)], ['RAM', `${base.ram_gb} GB`, `${rival.ram_gb} GB`],
        [ru ? 'Диск' : 'Disk', `${base.disk_gb} GB ${base.disk_type}`, `${rival.disk_gb} GB ${rival.disk_type}`],
        [ru ? 'Класс CPU' : 'CPU class', base.cpu_class || '—', rival.cpu_class || '—'],
      ].map(([label, a, b]) => <div className="comparison-row" role="row" key={label}><strong>{label}</strong><span>{a}</span><span>{b}</span></div>)}</div>}
    </section>
    {analysis && <section className="argument-grid" key={`${base?.id}-${rival?.id}-${ipv4}`}>
      <article className="panel argument-card good"><div className="argument-title"><Check/><div><span>Aéza</span><h2>{ru ? 'Подтверждённые преимущества' : 'Verified advantages'}</h2></div></div>{analysis.strengths.map(item => <p key={item}><Check/>{item}</p>)}</article>
      <article className="panel argument-card watch"><div className="argument-title"><Scale/><div><span>{ru ? 'Честное сравнение' : 'Fair comparison'}</span><h2>{ru ? 'Ограничения и уступки' : 'Caveats and tradeoffs'}</h2></div></div>{analysis.caveats.length ? analysis.caveats.map(item => <p key={item}><Scale/>{item}</p>) : <p><Check/>{ru ? 'По опубликованным полям явных уступок нет.' : 'No evident tradeoffs in published fields.'}</p>}</article>
    </section>}
    {analysis && company && rival && <section className="panel radar-conclusion"><h2>{ru ? 'Вывод для этого сравнения' : 'Conclusion for this comparison'}</h2><p>{analysis.verdict}</p><small>{ru ? 'Основано на опубликованных ценах и ресурсах. Скорость, SLA и качество поддержки проверяйте отдельно.' : 'Based on published prices and resources. Test speed, SLA and support quality separately.'}</small><div className="radar-evidence-links"><a href={aeza?.source_url} target="_blank" rel="noreferrer">Aéza <ExternalLink size={14}/></a><a href={company.source_url} target="_blank" rel="noreferrer">{company.name} <ExternalLink size={14}/></a></div></section>}
    {response && company && <section className="panel radar-concern"><div className="argument-title"><MessageCircleQuestion/><div><span>{ru ? 'Разговор с клиентом' : 'Customer conversation'}</span><h2>{ru ? 'Что его беспокоит?' : 'What is the concern?'}</h2></div></div><div className="radar-company-tabs" role="group" aria-label={ru ? 'Проблема клиента' : 'Customer concern'}>{(Object.keys(concernNames) as Concern[]).map(key => <button key={key} type="button" className={concern === key ? 'selected' : ''} onClick={() => setConcern(key)}>{concernNames[key][language]}</button>)}</div><p>{response.text}</p><a href={response.url} target="_blank" rel="noreferrer">{ru ? 'Проверить условие' : 'Check the policy'} <ExternalLink size={14}/></a><small>{ru ? 'Это вопросы для выявления потребности, а не утверждения о жалобах всех пользователей.' : 'These are discovery prompts, not claims about all customers’ complaints.'}</small></section>}
    <section className="panel radar-register"><div className="panel-heading"><div><h2>{ru ? 'Все готовые тарифы в радаре' : 'All fixed plans in the radar'}</h2><p>{ru ? 'Полные опубликованные линейки выбранных страниц. Индивидуальные конфигурации и акции с предоплатой не включены.' : 'Complete published lineups from selected pages. Custom configurations and prepaid promotions are excluded.'}</p></div></div><div className="radar-source-list">{catalog?.providers.map(p => <details key={p.id} className="radar-provider-list"><summary><strong>{p.name}</strong><span>{p.plans.length} {ru ? 'тарифов' : 'plans'} · {ru ? 'Проверено' : 'Checked'}: {date(p.fetched_at, ru)}{p.stale || p.error ? ` · ${ru ? 'нужно обновить' : 'refresh pending'}` : ''}</span><ChevronDown size={18}/></summary><div className="radar-all-plans">{p.plans.map(plan => <div key={plan.id}><strong>{plan.name}</strong><span>{rub(plan.price_rub)}{plan.billing === 'daily_30_day_equivalent' ? (ru ? ' / 30 дней' : ' / 30 days') : (ru ? ' / мес.' : ' / mo.')} · {plan.cpu} vCPU · {plan.ram_gb} GB RAM · {plan.disk_gb} GB {plan.disk_type}{plan.ipv4_extra_rub ? ` · IPv4 +${rub(plan.ipv4_extra_rub)}` : ''}</span></div>)}</div><a href={p.source_url} target="_blank" rel="noreferrer">{ru ? 'Официальный источник' : 'Official source'} <ArrowUpRight size={16}/></a></details>)}</div></section>
  </div>;
}
function Freshness({ provider, ru }: { provider?: Provider; ru: boolean }) { return <small className={`radar-freshness ${provider?.stale || provider?.error ? 'stale' : ''}`}>{ru ? 'Проверено' : 'Checked'}: {date(provider?.fetched_at || null, ru)}{provider?.stale || provider?.error ? ` · ${ru ? 'ожидает обновления' : 'refresh pending'}` : ''}</small>; }
function PlanCard({ plan, ru, ipv4 }: { plan: Plan; ru: boolean; ipv4: boolean }) { return <div className="radar-selected-plan" key={plan.id}><div><strong>{plan.name}</strong><span>{rub(total(plan, ipv4))}<small> / {plan.billing === 'daily_30_day_equivalent' ? (ru ? '30 дней' : '30 days') : (ru ? 'мес.' : 'mo.')}</small></span></div><p>{plan.cpu} vCPU · {plan.ram_gb} GB RAM · {plan.disk_gb} GB {plan.disk_type}</p>{plan.native_price_rub !== undefined && <small>{ru ? 'Оплата' : 'Billing'}: {rub(plan.native_price_rub)} / {ru ? 'день' : 'day'}</small>}{ipv4 && !!plan.ipv4_extra_rub && <small>{ru ? 'Включая публичный IPv4' : 'Including public IPv4'}: +{rub(plan.ipv4_extra_rub)}</small>}</div>; }
