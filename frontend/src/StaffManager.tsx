import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

type Staff = { id: number; login: string; display_name: string | null; role: 'admin' | 'employee'; is_active: boolean };

export function StaffManager() {
  const query = useQuery({ queryKey: ['staff'], queryFn: () => api<{ items: Staff[] }>('/staff') });
  const qc = useQueryClient();
  const [form, setForm] = useState({ login: '', display_name: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/staff', { method: 'POST', body: JSON.stringify(form) });
      setForm({ login: '', display_name: '', password: '' });
      await qc.invalidateQueries({ queryKey: ['staff'] });
      setResetId(null); setResetPassword('');
      setNotice('Сотрудник создан. Передайте ему пароль лично.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function update(person: Staff, payload: { is_active?: boolean; new_password?: string }) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/staff/${person.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      await qc.invalidateQueries({ queryKey: ['staff'] });
      setResetId(null); setResetPassword('');
      setNotice(payload.new_password ? 'Пароль сброшен, прежние сеансы завершены.' : payload.is_active ? 'Доступ восстановлен.' : 'Доступ отключён, сеансы завершены.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="panel account-panel staff-panel">
    <div className="account-section-heading"><div><h3>Сотрудники</h3><p>Отдельные учётные записи для работы с клиентами. Настройки модели и импорт доступны администратору.</p></div></div>
    {error && <p className="staff-feedback" role="alert">{error}</p>}
    {notice && <p className="staff-feedback" role="status">{notice}</p>}
    <form className="account-form staff-create-form" onSubmit={create}>
      <label>Логин<input value={form.login} onChange={event => setForm({ ...form, login: event.target.value })} pattern="[A-Za-z0-9_.-]+" minLength={3} maxLength={40} required autoComplete="off" /></label>
      <label>Имя сотрудника<input value={form.display_name} onChange={event => setForm({ ...form, display_name: event.target.value })} maxLength={80} required autoComplete="off" /></label>
      <label>Временный пароль<input value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} type="password" minLength={12} required autoComplete="new-password" /></label>
      <button className="primary" disabled={busy}>Добавить сотрудника</button>
    </form>
    {query.isError && <p role="alert">{query.error.message}</p>}
    <ul className="staff-list">{query.data?.items.map(person => <li key={person.id}>
      <div><strong>{person.display_name || person.login}</strong><small>@{person.login} · {person.role === 'admin' ? 'Администратор' : 'Сотрудник'} · {person.is_active ? 'Активен' : 'Отключён'}</small></div>
      {person.role === 'employee' && <div className="staff-actions">
        <button className="secondary" disabled={busy} onClick={() => update(person, { is_active: !person.is_active })}>{person.is_active ? 'Отключить' : 'Включить'}</button>
        <button className="secondary" disabled={busy} onClick={() => { setResetId(resetId === person.id ? null : person.id); setResetPassword(''); }}>Сбросить пароль</button>
      </div>}
      {resetId === person.id && <form className="account-form staff-reset-form" onSubmit={event => { event.preventDefault(); void update(person, { new_password: resetPassword }); }}>
        <label>Новый пароль<input type="password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} minLength={12} required autoComplete="new-password" /></label>
        <button className="primary" disabled={busy}>Сохранить пароль</button>
      </form>}
    </li>)}</ul>
  </section>;
}
