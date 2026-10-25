import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Search, Sparkles, X } from 'lucide-react';
import { api } from './api';

export type AppView = 'overview' | 'customers' | 'competitors' | 'settings' | 'source' | 'actions' | 'outcomes' | 'account' | 'appearance' | 'help';
export type HelpTarget = AppView | 'search' | 'scenario' | 'horizon';
type Language = 'ru' | 'en';
type Copy = { ru: string; en: string };
type Entry = { id: string; target: HelpTarget; title: Copy; description: Copy; hint: Copy };
type Spotlight = { left: number; top: number; width: number; eyebrow: string; title: string; subtitle: string };
const copy = (ru: string, en: string): Copy => ({ ru, en });

export const HELP_ENTRIES: Entry[] = [
  { id: 'overview', target: 'overview', title: copy('Обзор рисков', 'Risk overview'), description: copy('Главные показатели, распределение риска и график будущих платежей.', 'Key metrics, risk distribution and the payment forecast.'), hint: copy('Начните здесь: проверьте число клиентов с высоким риском и сумму под риском.', 'Start here: review high-risk customers and the amount at risk.') },
  { id: 'customers', target: 'customers', title: copy('Клиенты', 'Customers'), description: copy('Рейтинг клиентов, причины оценки, услуги и карточки с расчётом «что если».', 'Customer ranking, scoring reasons, services and profiles with what-if calculations.'), hint: copy('Найдите клиента по email или ID; новый клиент добавляется кнопкой над таблицей.', 'Find a customer by email or ID; add one with the button above the table.') },
  { id: 'competitors', target: 'competitors', title: copy('Конкурентный радар', 'Competitive radar'), description: copy('Сравнение Aéza с FirstVDS, RUVDS, Selectel, AdminVPS и Beget: тарифы, источники и ответы на вопросы клиента.', 'Compare Aéza with FirstVDS, RUVDS, Selectel, AdminVPS and Beget: plans, sources and customer concerns.'), hint: copy('Выберите Aéza слева, компанию и тариф справа. Ниже — вывод, вопросы клиента и все готовые тарифы. Источники проверяются раз в 3 дня.', 'Choose Aéza on the left, then a provider and plan on the right. See the conclusion, customer questions and full fixed-plan list below. Sources refresh every 3 days.') },
  { id: 'actions', target: 'actions', title: copy('Работа с клиентами', 'Customer work'), description: copy('Очередь активных карточек с ответственными, напоминаниями и историей разговоров.', 'Active outreach cards with owners, reminders and conversation history.'), hint: copy('«Сохранить план» оставляет карточку в работе; «Сохранить в результаты» завершает её и переносит в результаты.', 'Save plan keeps the card in progress; Save to outcomes completes and moves it to Outcomes.') },
  { id: 'outcomes', target: 'outcomes', title: copy('Результаты', 'Outcomes'), description: copy('Завершённые карточки, отмеченные продления и связанные платежи.', 'Completed cards, recorded renewals and associated payments.'), hint: copy('После «Сохранить в результаты» карточка появится здесь и уйдёт из активной очереди. Денежные суммы не равны фактической выручке.', 'Save to outcomes moves the card here from the active queue. Money amounts are not actual revenue.') },
  { id: 'settings', target: 'settings', title: copy('Модель риска', 'Risk model'), description: copy('Веса признаков, пороги и параметры расчёта.', 'Feature weights, thresholds and calculation settings.'), hint: copy('После сохранения параметров оценки клиентов пересчитываются.', 'Customer scores are recalculated when settings are saved.') },
  { id: 'source', target: 'source', title: copy('Источники данных', 'Data sources'), description: copy('Импорт и экспорт снимка, демосценарии и диагностика клиентов без оценки.', 'Snapshot import and export, demo scenarios and diagnostics for unscored customers.'), hint: copy('Откройте причину отсутствия оценки, проверьте указанные поля источника. Импорт заменяет реестр целиком.', 'Open an unscored customer to inspect the source fields. Import replaces the whole registry.') },
  { id: 'appearance', target: 'appearance', title: copy('Настройки сайта', 'Site settings'), description: copy('Тема, язык, валюта и включение помощника.', 'Theme, language, currency and guide preferences.'), hint: copy('Настройки интерфейса сохраняются на этом устройстве.', 'Display preferences are saved on this device.') },
  { id: 'account', target: 'account', title: copy('Настройки аккаунта', 'Account settings'), description: copy('Имя, email, пароль, сеансы и способы входа.', 'Name, email, password, sessions and sign-in methods.'), hint: copy('Открываются через меню профиля справа сверху.', 'Open this section from the profile menu at the top right.') },
  { id: 'search', target: 'search', title: copy('Поиск сверху', 'Top search'), description: copy('Быстрый переход к разделам и поиск клиентов по email или ID.', 'Jump to sections and find customers by email or ID.'), hint: copy('Нажмите поле по центру верхней панели; на телефоне — значок лупы.', 'Use the field in the center of the top bar; on mobile, tap the search icon.') },
  { id: 'chart', target: 'overview', title: copy('График платежей', 'Payment chart'), description: copy('Платежи по дням и сценарная сумма под риском на выбранном горизонте.', 'Daily payments and the scenario amount at risk within the selected horizon.'), hint: copy('На обзоре нажмите «К графику» или прокрутите страницу вниз.', 'On the overview, choose “View chart” or scroll down.') },
  { id: 'scenario', target: 'scenario', title: copy('Что если?', 'What if?'), description: copy('Пробный пересчёт с другим балансом или автопродлением без изменения данных.', 'Try another balance or auto-renewal value without changing source data.'), hint: copy('Откройте карточку клиента или кнопку «Что если?» в обзоре.', 'Open a customer profile or use “What if?” in the overview.') },
  { id: 'horizon', target: 'horizon', title: copy('Горизонт анализа', 'Analysis horizon'), description: copy('Окно прогноза на 1, 7, 14 или 30 дней.', 'Forecast window of 1, 7, 14 or 30 days.'), hint: copy('Выбор находится вверху каждого раздела и пересчитывает оценки.', 'The selector appears at the top of each section and recalculates scores.') },
  { id: 'sign-in', target: 'account', title: copy('Вход и безопасность', 'Sign-in and security'), description: copy('Пароль, единый вход, запоминание сеанса и завершение других сеансов.', 'Password, single sign-on, remembered sessions and ending other sessions.'), hint: copy('Выход находится в меню профиля; настройки безопасности — в аккаунте.', 'Sign out from the profile menu; manage security in Account settings.') },
];

export const GUIDE_ENTRIES = ['overview', 'customers', 'competitors', 'search', 'actions', 'settings', 'source', 'outcomes', 'appearance']
  .map(id => HELP_ENTRIES.find(entry => entry.id === id)!);
const GUIDE_FOX_STATES = ['assistant', 'thinking', 'laptop', 'idea', 'thinking', 'laptop', 'celebrate', 'celebrate'] as const;

export function GlobalSearch({ language, open, onOpenChange, onNavigate, onCustomer }: {
  language: Language; open: boolean; onOpenChange: (open: boolean) => void;
  onNavigate: (target: HelpTarget) => void; onCustomer: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(query.trim()), 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onOpenChange(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onOpenChange]);
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return HELP_ENTRIES.filter(item => !term || item.title.ru.toLocaleLowerCase().includes(term) || item.title.en.toLocaleLowerCase().includes(term) || item.description.ru.toLocaleLowerCase().includes(term) || item.description.en.toLocaleLowerCase().includes(term)).slice(0, term ? 4 : 5);
  }, [query, language]);
  const customers = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => api(`/customers?search=${encodeURIComponent(debounced)}&page_size=5`),
    enabled: open && debounced.length > 0,
    staleTime: 10_000,
  });
  const customerItems = debounced === query.trim() ? (customers.data?.items || []) : [];
  const options = [...matches.map(item => ({ kind: 'section' as const, id: item.id, label: item.title[language], target: item.target })),
    ...customerItems.map((item: any) => ({ kind: 'customer' as const, id: String(item.id), label: item.email, target: item.id as number }))];
  const choose = (option: typeof options[number]) => {
    onOpenChange(false); setQuery(''); setActive(0);
    if (option.kind === 'customer') onCustomer(option.target as number);
    else onNavigate(option.target as HelpTarget);
  };
  return <div className={`topbar-search ${open ? 'is-open' : ''}`} ref={root}>
    <button className="global-search-trigger icon-btn" type="button" aria-label={language === 'ru' ? 'Открыть поиск' : 'Open search'} aria-expanded={open} onClick={() => onOpenChange(!open)}><Search size={19} /></button>
    <div className="global-search-box">
      <Search size={17} aria-hidden="true" />
      <input ref={input} value={query} onFocus={() => onOpenChange(true)} onChange={event => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { onOpenChange(false); input.current?.blur(); }
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, Math.max(0, options.length - 1))); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
          if (event.key === 'Enter' && options[active]) { event.preventDefault(); choose(options[active]); }
        }}
        role="combobox" aria-expanded={open} aria-controls="global-search-results" aria-activedescendant={open && options[active] ? `global-result-${active}` : undefined}
        aria-label={language === 'ru' ? 'Поиск по сайту и клиентам' : 'Search site and customers'}
        placeholder={language === 'ru' ? 'Раздел, email или ID клиента' : 'Section, email or customer ID'} />
      {query && <button className="global-search-clear icon-btn" type="button" aria-label={language === 'ru' ? 'Очистить поиск' : 'Clear search'} onClick={() => { setQuery(''); input.current?.focus(); }}><X size={15} /></button>}
      {open && <div className="global-search-results" id="global-search-results" role="listbox">
        {options.map((option, index) => <button id={`global-result-${index}`} key={`${option.kind}-${option.id}`} type="button" role="option" aria-selected={index === active}
          className={index === active ? 'selected' : ''} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
          {option.kind === 'section' ? <BookOpen size={16} /> : <Search size={16} />}<span><strong>{option.label}</strong>{option.kind === 'customer' && <small>ID #{option.id}</small>}</span><ChevronRight size={14} />
        </button>)}
        {query.trim() && !options.length && !customers.isFetching && <p>{language === 'ru' ? 'Совпадений нет' : 'No matches'}</p>}
        {customers.isFetching && <p>{language === 'ru' ? 'Ищем клиентов…' : 'Searching customers…'}</p>}
      </div>}
    </div>
  </div>;
}

export function HelpCenter({ language, onGo, onStartGuide }: { language: Language; onGo: (target: HelpTarget) => void; onStartGuide: () => void }) {
  return <div className="help-center">
    <section className="panel help-intro"><BookOpen size={25} /><div><h2>{language === 'ru' ? 'Справочник по сайту' : 'Site guide'}</h2><p>{language === 'ru' ? 'Выберите тему или откройте нужный раздел. Помощник проведёт вас по основным шагам.' : 'Choose a topic or open a section. The assistant can walk you through the basics.'}</p></div><button className="secondary" onClick={onStartGuide}><Sparkles size={16} />{language === 'ru' ? 'Запустить помощника' : 'Start assistant'}</button></section>
    <div className="help-grid">{HELP_ENTRIES.map(entry => <article className="panel help-card" key={entry.id}><h3>{entry.title[language]}</h3><p>{entry.description[language]}</p><small>{entry.hint[language]}</small><button onClick={() => onGo(entry.target)}>{language === 'ru' ? 'Перейти' : 'Open'} <ArrowRight size={15} /></button></article>)}</div>
  </div>;
}

const FOX_TOPICS = [
  { ru: 'Как найти клиента?', en: 'How do I find a customer?' },
  { ru: 'Что означают платежи под риском?', en: 'What are payments at risk?' },
  { ru: 'Где поменять тему?', en: 'Where can I change the theme?' },
];
const FOX_STOP_WORDS = new Set(['как', 'где', 'что', 'это', 'мне', 'the', 'how', 'where', 'can', 'with']);
const FOX_ALIASES: Record<string, string> = {
  'theme': 'appearance', 'тему': 'appearance', 'темы': 'appearance', 'цвет': 'appearance',
  'платеж': 'chart', 'оплат': 'chart', 'payment': 'chart', 'chart': 'chart',
  'очеред': 'actions', 'контакт': 'actions', 'queue': 'actions',
  'вход': 'sign-in', 'парол': 'sign-in', 'login': 'sign-in',
};

function foxMatches(question: string, language: Language) {
  const tokens = question.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !FOX_STOP_WORDS.has(word)).map(word => word.slice(0, 5));
  return HELP_ENTRIES.map(entry => {
    const title = entry.title[language].toLocaleLowerCase();
    const description = entry.description[language].toLocaleLowerCase();
    const hint = entry.hint[language].toLocaleLowerCase();
    const score = tokens.reduce((total, token) => total + (title.includes(token) ? 4 : 0) + (description.includes(token) ? 2 : 0) + (hint.includes(token) ? 1 : 0) + (Object.entries(FOX_ALIASES).some(([word, id]) => word.startsWith(token) && id === entry.id) ? 5 : 0), 0);
    return { entry, score };
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function FoxQuestionDialog({ language, onClose, onNavigate }: { language: Language; onClose: () => void; onNavigate: (target: HelpTarget) => void }) {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const answers = useMemo(() => foxMatches(asked, language), [asked, language]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    input.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', escape); };
  }, []);
  return <div className="fox-question-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="fox-question-dialog" role="dialog" aria-modal="true" aria-labelledby="fox-question-title">
      <header><div><img src="/fox-thinking.png" alt="" aria-hidden="true" /><div><span>AÉZA RETENTION</span><h2 id="fox-question-title">{language === 'ru' ? 'Спросить у лисёнка' : 'Ask the fox'}</h2></div></div><button type="button" className="icon-btn" onClick={onClose} aria-label={language === 'ru' ? 'Закрыть' : 'Close'}><X size={20} /></button></header>
      <p>{language === 'ru' ? 'Помогу найти функцию и объясню, как ей пользоваться.' : 'I can help you find a feature and explain how to use it.'}</p>
      <form onSubmit={event => { event.preventDefault(); setAsked(question.trim()); }}><input ref={input} value={question} onChange={event => setQuestion(event.target.value)} maxLength={180} aria-label={language === 'ru' ? 'Вопрос лисёнку' : 'Question for the fox'} placeholder={language === 'ru' ? 'Например: где график платежей?' : 'For example: where is the payment chart?'} /><button className="primary" type="submit" disabled={!question.trim()}>{language === 'ru' ? 'Спросить' : 'Ask'} <ArrowRight size={16} /></button></form>
      {!asked && <div className="fox-question-topics">{FOX_TOPICS.map(topic => <button type="button" key={topic.ru} onClick={() => { setQuestion(topic[language]); setAsked(topic[language]); }}>{topic[language]}</button>)}</div>}
      {asked && <div className="fox-question-answers" aria-live="polite">{answers.length ? <><span>{language === 'ru' ? 'Вот что я нашёл' : 'Here is what I found'}</span>{answers.map(({ entry }) => <article key={entry.id}><h3>{entry.title[language]}</h3><p>{entry.description[language]}</p><small>{entry.hint[language]}</small><button type="button" onClick={() => onNavigate(entry.target)}>{language === 'ru' ? 'Перейти к разделу' : 'Open section'} <ArrowRight size={15} /></button></article>)}</> : <p>{language === 'ru' ? 'Пока не нашёл точного ответа. Попробуйте название раздела или откройте справочник.' : 'No exact match yet. Try a section name or open the site guide.'}</p>}</div>}
    </section>
  </div>;
}

export function GuideDialog({ language, step, onPrevious, onNext, onClose }: { language: Language; step: number; onPrevious: () => void; onNext: () => void; onClose: () => void }) {
  const entry = GUIDE_ENTRIES[step];
  const foxState = GUIDE_FOX_STATES[step] || 'assistant';
  const foxSource = `/fox-${foxState}.png`;
  const first = step === 0;
  const last = step === GUIDE_ENTRIES.length - 1;
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const heading = document.querySelector<HTMLElement>('.page-heading > div:first-child');
        if (!heading) { setSpotlight(null); return; }
        const rect = heading.getBoundingClientRect();
        setSpotlight({
          left: Math.max(12, rect.left - 14),
          top: Math.max(12, rect.top - 12),
          width: Math.min(Math.max(rect.width + 28, 250), window.innerWidth - 24),
          eyebrow: heading.querySelector<HTMLElement>('.eyebrow')?.textContent || 'AÉZA RETENTION',
          title: heading.querySelector<HTMLElement>('h1')?.textContent?.trim() || entry.title[language],
          subtitle: heading.querySelector<HTMLElement>('p')?.textContent?.trim() || entry.description[language],
        });
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step, language, entry.title, entry.description]);
  return <div className="guide-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    {spotlight && <div className="guide-spotlight" style={{ left: spotlight.left, top: spotlight.top, width: spotlight.width }} aria-hidden="true">
      <div className="guide-spotlight-copy">
        <span>{spotlight.eyebrow}</span>
        <strong>{spotlight.title}</strong>
        <small>{spotlight.subtitle}</small>
      </div>
      <div className="guide-pointer"><ArrowLeft aria-hidden="true" /></div>
    </div>}
    <section ref={dialog} className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title" aria-describedby="guide-description">
      <img key={foxState} className={`guide-fox guide-fox-${foxState}`} src={foxSource} alt="" aria-hidden="true" />
      <div className="guide-header"><span><img key={`icon-${foxState}`} src={foxSource} alt="" aria-hidden="true" /> {language === 'ru' ? 'Лисёнок Aéza' : 'Aéza fox'}</span><button ref={close} className="icon-btn" onClick={onClose} aria-label={language === 'ru' ? 'Закрыть помощника' : 'Close assistant'}><X size={18} /></button></div>
      <div className="guide-progress" aria-label={`${step + 1} / ${GUIDE_ENTRIES.length}`}>{GUIDE_ENTRIES.map((item, index) => <i key={item.id} className={index <= step ? 'active' : ''} />)}</div>
      <small>{language === 'ru' ? `Шаг ${step + 1} из ${GUIDE_ENTRIES.length}` : `Step ${step + 1} of ${GUIDE_ENTRIES.length}`}</small>
      <h2 id="guide-title">{entry.title[language]}</h2>
      <p id="guide-description">{entry.description[language]}</p>
      <div className="guide-tip"><Check size={16} /><span>{entry.hint[language]}</span></div>
      <div className="guide-actions"><button className="secondary" onClick={first ? onClose : onPrevious}><ArrowLeft size={15} />{first ? (language === 'ru' ? 'Пропустить' : 'Skip') : (language === 'ru' ? 'Назад' : 'Back')}</button><button className="primary" onClick={onNext}>{last ? (language === 'ru' ? 'Готово' : 'Done') : (language === 'ru' ? 'Далее' : 'Next')}<ArrowRight size={15} /></button></div>
    </section>
  </div>;
}
