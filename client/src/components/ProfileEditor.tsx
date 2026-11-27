import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CalendarDays, Camera, ChevronDown, ChevronLeft, ChevronRight, ShieldCheck, X } from 'lucide-react';
import { API } from '../config';
import type { Gender, RelationshipStatus, User } from '../types';
import '../profile.css';

type ProfileEditorProps = {
  user: User;
  token: string;
  onCancel: () => void;
  onUserChange: (user: User) => void;
  onTokenChange: (token: string) => void;
};

type ChoiceOption = { value: string; label: string };
function ProfileChoiceField({ id, label, value, options, placeholder, onChange }: {
  id: string;
  label: string;
  value: string;
  options: ChoiceOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedLabel = options.find(option => option.value === value)?.label;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = fieldRef.current?.getBoundingClientRect();
    const estimatedMenuHeight = Math.min(options.length * 42 + 12, 220);
    setOpenAbove(Boolean(rect && window.innerHeight - rect.bottom < estimatedMenuHeight && rect.top > estimatedMenuHeight));
    setOpen(true);
  }

  return (
    <div className={`profile-field profile-choice-field ${open ? 'open' : ''}`} ref={fieldRef}>
      <span id={`${id}-label`}>{label}</span>
      <button ref={triggerRef} id={id} type="button" className="profile-choice-trigger" role="combobox" aria-labelledby={`${id}-label ${id}-value`} aria-controls={`${id}-options`} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
        <span id={`${id}-value`} className={selectedLabel ? '' : 'placeholder'}>{selectedLabel || placeholder}</span>
        <ChevronDown size={16}/>
      </button>
      {open && <div id={`${id}-options`} className={`profile-choice-menu ${openAbove ? 'open-above' : ''}`} role="listbox" aria-labelledby={`${id}-label`}>
        {options.map(option => <button
          type="button"
          role="option"
          aria-selected={value === option.value}
          className={value === option.value ? 'selected' : ''}
          key={option.value}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
            triggerRef.current?.focus();
          }}
        >{option.label}</button>)}
      </div>}
    </div>
  );
}

const AVATAR_COLORS = ['#5524c8', '#2368c4', '#16816e', '#b24b6a', '#b46b13', '#5b6475'];
const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
  { value: 'NON_BINARY', label: 'Non-binary' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' }
];
const RELATIONSHIP_OPTIONS: { value: RelationshipStatus; label: string }[] = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED', label: 'Married' },
  { value: 'HIDDEN', label: 'Hidden' }
];
const MONTH_NAMES = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2020, month, 1)));
const WEEKDAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calculateAge(dateOfBirth: string) {
  if (!dateOfBirth) return '';
  const birth = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? String(age) : '';
}

function initialsFor(user: Pick<User, 'username' | 'firstName' | 'lastName'>, firstName: string, lastName: string) {
  const initials = `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase();
  return initials || user.username.charAt(0).toUpperCase();
}

export function ProfileEditor({ user, token, onCancel, onUserChange, onTokenChange }: ProfileEditorProps) {
  const [username, setUsername] = useState(user.username);
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [email, setEmail] = useState(user.email || '');
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber || '');
  const [gender, setGender] = useState<Gender | ''>(user.gender || '');
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth?.slice(0, 10) || '');
  const [relationshipStatus, setRelationshipStatus] = useState<RelationshipStatus | ''>(user.relationshipStatus || '');
  const [avatarData, setAvatarData] = useState(user.avatarData || '');
  const [avatarColor, setAvatarColor] = useState(user.avatarColor || AVATAR_COLORS[0]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear() - 18);
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  const emailChanged = email.trim().toLowerCase() !== (user.email || '').toLowerCase();
  const age = calculateAge(dateOfBirth);
  const todayKey = dateKey(new Date());
  const minimumCalendarYear = Math.min(new Date().getFullYear() - 130, dateOfBirth ? Number(dateOfBirth.slice(0, 4)) : new Date().getFullYear() - 130);
  const yearOptions = Array.from({ length: new Date().getFullYear() - minimumCalendarYear + 1 }, (_, index) => new Date().getFullYear() - index);
  const firstDayOfMonth = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const calendarCells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstDayOfMonth + 1;
    if (day < 1 || day > daysInMonth) return null;
    const value = dateKey(new Date(calendarYear, calendarMonth, day));
    return { day, value, isToday: value === todayKey, isSelected: value === dateOfBirth, isFuture: value > todayKey };
  });
  const formattedDateOfBirth = dateOfBirth
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${dateOfBirth}T12:00:00`))
    : '';
  const dirty = username.trim() !== user.username ||
    firstName.trim() !== (user.firstName || '') ||
    lastName.trim() !== (user.lastName || '') ||
    email.trim().toLowerCase() !== (user.email || '').toLowerCase() ||
    phoneNumber.trim() !== (user.phoneNumber || '') ||
    gender !== (user.gender || '') ||
    dateOfBirth !== (user.dateOfBirth?.slice(0, 10) || '') ||
    relationshipStatus !== (user.relationshipStatus || '') ||
    avatarData !== (user.avatarData || '') ||
    avatarColor !== (user.avatarColor || AVATAR_COLORS[0]);

  useEffect(() => {
    if (!calendarOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!calendarRef.current?.contains(event.target as Node)) setCalendarOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCalendarOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [calendarOpen]);

  function openCalendar() {
    const initialDate = dateOfBirth ? new Date(`${dateOfBirth}T12:00:00`) : new Date();
    if (!dateOfBirth) initialDate.setFullYear(initialDate.getFullYear() - 18);
    setCalendarMonth(initialDate.getMonth());
    setCalendarYear(initialDate.getFullYear());
    setCalendarOpen(true);
  }

  function changeCalendarMonth(amount: number) {
    const nextMonth = new Date(calendarYear, calendarMonth + amount, 1);
    if (nextMonth > new Date(new Date().getFullYear(), new Date().getMonth(), 1) || nextMonth.getFullYear() < minimumCalendarYear) return;
    setCalendarMonth(nextMonth.getMonth());
    setCalendarYear(nextMonth.getFullYear());
  }

  function updateEmail(value: string) {
    setEmail(value);
    setVerificationCode('');
    setCodeSent(false);
    setEmailVerified(false);
    setError('');
    setNotice('');
  }

  async function sendVerificationCode() {
    if (!emailInputRef.current?.reportValidity()) return;
    setEmailBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API}/api/users/me/email-verification/request`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || `Unable to send verification code (${response.status})`);
      setCodeSent(true);
      setNotice(data.message || 'Verification code sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send verification code');
    } finally {
      setEmailBusy(false);
    }
  }

  async function verifyEmailCode() {
    setEmailBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API}/api/users/me/email-verification/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: verificationCode.trim() })
      });
      const data = await response.json().catch(() => ({})) as { verified?: boolean; error?: string };
      if (!response.ok || !data.verified) throw new Error(data.error || 'Email verification failed');
      setEmailVerified(true);
      setNotice('Email verified. Save your profile to apply the change.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email verification failed');
    } finally {
      setEmailBusy(false);
    }
  }

  function updatePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > 1_000_000) {
      setError('Profile photos must be 1 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('Unable to read the selected photo.');
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setError('Unable to read the selected photo.');
        return;
      }
      setAvatarData(reader.result);
      setError('');
    };
    reader.readAsDataURL(file);
  }

  function clearOptionalFields() {
    setFirstName('');
    setLastName('');
    setPhoneNumber('');
    setGender('');
    setDateOfBirth('');
    setRelationshipStatus('');
    setAvatarData('');
    setError('');
    setNotice('');
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (emailChanged && !emailVerified) {
      setError('Verify your new email address before saving.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${API}/api/users/me/profile`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim().toLowerCase(),
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          phoneNumber: phoneNumber.trim() || null,
          gender: gender || null,
          dateOfBirth: dateOfBirth || null,
          relationshipStatus: relationshipStatus || null,
          avatarData: avatarData || null,
          avatarColor
        })
      });
      const data = await response.json().catch(() => ({})) as { user?: User; token?: string; error?: string };
      if (!response.ok) throw new Error(data.error || `Profile update failed (${response.status})`);
      if (!data.user || !data.token) throw new Error('Invalid response while updating profile');
      onUserChange(data.user);
      onTokenChange(data.token);
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="profile-page">
      <section className="profile-editor">
        <header className="profile-editor-header">
          <button type="button" className="profile-cancel-icon" aria-label="Cancel profile editing" title="Cancel" onClick={onCancel} disabled={saving}>
            <X size={21}/>
          </button>
          <div>
            <h1>Edit profile</h1>
            <p>Update your HeyBuddy profile details.</p>
          </div>
        </header>
        <form className="profile-editor-form" onSubmit={saveProfile}>
          <div className="profile-editor-content">
            <section className="profile-avatar-editor" aria-label="Profile photo and initial color">
              <div className="profile-preview" style={{ backgroundColor: avatarColor }}>
                {avatarData ? <img src={avatarData} alt="Profile preview"/> : <span>{initialsFor(user, firstName, lastName)}</span>}
              </div>
              <div className="profile-avatar-controls">
                <strong>Profile photo or initials</strong>
                <div className="profile-photo-actions">
                  <button type="button" className="profile-photo-button" onClick={() => fileInputRef.current?.click()}><Camera size={16}/> Upload photo</button>
                  {avatarData && <button type="button" className="profile-photo-remove" onClick={() => setAvatarData('')}>Remove photo</button>}
                </div>
                <input ref={fileInputRef} className="profile-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={updatePhoto}/>
                <span className="profile-hint">JPG, PNG, or WebP up to 1 MB.</span>
                <div className="avatar-color-picker" role="group" aria-label="Initial color">
                  {AVATAR_COLORS.map(color => <button
                    key={color}
                    type="button"
                    className={`avatar-color-option ${avatarColor === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    aria-label={`Choose initial color ${color}`}
                    aria-pressed={avatarColor === color}
                    onClick={() => setAvatarColor(color)}
                  />)}
                </div>
              </div>
            </section>

            <div className="profile-fields">
              <label className="profile-field">
                <span>Username</span>
                <input value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]{3,24}" autoComplete="username" required/>
                <small>3–24 letters, numbers, or underscores. Must be unique.</small>
              </label>
              <label className="profile-field">
                <span>First name</span>
                <input value={firstName} onChange={event => setFirstName(event.target.value)} maxLength={80} autoComplete="given-name"/>
              </label>
              <label className="profile-field">
                <span>Last name</span>
                <input value={lastName} onChange={event => setLastName(event.target.value)} maxLength={80} autoComplete="family-name"/>
              </label>
              <div className="profile-field profile-email-field">
                <label htmlFor="profile-email">Email address</label>
                <div className="profile-email-row">
                  <input ref={emailInputRef} id="profile-email" type="email" value={email} onChange={event => updateEmail(event.target.value)} maxLength={254} autoComplete="email" required/>
                  {emailChanged && !emailVerified && <button type="button" className="profile-verify-button" onClick={() => void sendVerificationCode()} disabled={emailBusy}>{emailBusy ? 'Sending…' : codeSent ? 'Resend code' : 'Send OTP'}</button>}
                  {emailChanged && emailVerified && <span className="profile-verified"><ShieldCheck size={17}/> Verified</span>}
                </div>
                {emailChanged && codeSent && !emailVerified && <div className="profile-otp-row">
                  <input aria-label="Email verification code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}/>
                  <button type="button" className="profile-verify-button" onClick={() => void verifyEmailCode()} disabled={emailBusy || verificationCode.length !== 6}>{emailBusy ? 'Checking…' : 'Verify OTP'}</button>
                </div>}
                {emailChanged && <small>Changing your email requires a one-time verification code.</small>}
              </div>
              <label className="profile-field">
                <span>Phone number</span>
                <input type="tel" value={phoneNumber} onChange={event => setPhoneNumber(event.target.value)} maxLength={24} pattern="\\+?[0-9().\\-\\s]*" autoComplete="tel" placeholder="+1 555 123 4567"/>
              </label>
              <ProfileChoiceField id="profile-gender" label="Gender" value={gender} options={GENDER_OPTIONS} placeholder="Select gender" onChange={value => setGender(value as Gender)}/>
              <div className="profile-field profile-date-field" ref={calendarRef}>
                <span id="profile-date-label">Date of birth</span>
                <button type="button" className="profile-date-trigger" aria-labelledby="profile-date-label" aria-haspopup="dialog" aria-expanded={calendarOpen} onClick={() => calendarOpen ? setCalendarOpen(false) : openCalendar()}>
                  <CalendarDays size={18}/>
                  <span>{formattedDateOfBirth || 'Choose your date of birth'}</span>
                  <ChevronDown size={16}/>
                </button>
                {calendarOpen && <div className="profile-calendar" role="dialog" aria-label="Choose date of birth">
                  <div className="profile-calendar-header">
                    <button type="button" aria-label="Previous month" onClick={() => changeCalendarMonth(-1)} disabled={calendarYear <= minimumCalendarYear && calendarMonth === 0}><ChevronLeft size={18}/></button>
                    <label>
                      <span className="visually-hidden">Month</span>
                      <select aria-label="Month" value={calendarMonth} onChange={event => setCalendarMonth(Number(event.target.value))}>
                        {MONTH_NAMES.map((month, index) => <option key={month} value={index} disabled={calendarYear === new Date().getFullYear() && index > new Date().getMonth()}>{month}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="visually-hidden">Year</span>
                    <select aria-label="Year" value={calendarYear} onChange={event => {
                      const nextYear = Number(event.target.value);
                      setCalendarYear(nextYear);
                      if (nextYear === new Date().getFullYear() && calendarMonth > new Date().getMonth()) setCalendarMonth(new Date().getMonth());
                    }}>
                        {yearOptions.map(year => <option key={year} value={year}>{year}</option>)}
                      </select>
                    </label>
                    <button type="button" aria-label="Next month" onClick={() => changeCalendarMonth(1)} disabled={calendarYear === new Date().getFullYear() && calendarMonth >= new Date().getMonth()}><ChevronRight size={18}/></button>
                  </div>
                  <div className="profile-calendar-grid" role="grid" aria-label={`${MONTH_NAMES[calendarMonth]} ${calendarYear}`}>
                    {WEEKDAY_NAMES.map(day => <span className="profile-calendar-weekday" role="columnheader" key={day}>{day}</span>)}
                    {calendarCells.map((cell, index) => cell ? <button
                      type="button"
                      role="gridcell"
                      key={cell.value}
                      className={`profile-calendar-day ${cell.isToday ? 'today' : ''} ${cell.isSelected ? 'selected' : ''}`}
                      aria-label={new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${cell.value}T12:00:00`))}
                      aria-pressed={cell.isSelected}
                      disabled={cell.isFuture}
                      onClick={() => {setDateOfBirth(cell.value);setCalendarOpen(false);}}
                    >{cell.day}</button> : <span className="profile-calendar-empty" key={`empty-${calendarYear}-${calendarMonth}-${index}`} aria-hidden="true"/> )}
                  </div>
                  <div className="profile-calendar-footer">
                    <button type="button" onClick={() => {setDateOfBirth('');setCalendarOpen(false);}}>Clear date</button>
                    <button type="button" onClick={() => {setDateOfBirth(todayKey);setCalendarOpen(false);}}>Today</button>
                  </div>
                </div>}
              </div>
              <label className="profile-field profile-age-field">
                <span>Age</span>
                <input value={age} readOnly placeholder="Calculated from date of birth"/>
              </label>
              <ProfileChoiceField id="profile-relationship-status" label="Relationship status" value={relationshipStatus} options={RELATIONSHIP_OPTIONS} placeholder="Select status" onChange={value => setRelationshipStatus(value as RelationshipStatus)}/>
            </div>
            {error && <div className="error profile-form-message" role="alert">{error}</div>}
            {notice && <div className="profile-notice" role="status">{notice}</div>}
          </div>
          <footer className="profile-editor-footer">
            <button type="button" className="profile-clear-button" onClick={clearOptionalFields} disabled={saving}>Clear</button>
            <button type="submit" className="profile-save-button" disabled={saving || !dirty || (emailChanged && !emailVerified)}>{saving ? 'Saving…' : 'Save'}</button>
          </footer>
        </form>
      </section>
    </main>
  );
}
