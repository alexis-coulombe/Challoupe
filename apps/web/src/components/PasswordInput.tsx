import type { ReactNode } from 'react';
import { Button, Input, Space, Tooltip } from 'antd';
import { SyncOutlined } from '@ant-design/icons';

const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;
const CATEGORIES = [LOWER, UPPER, DIGITS, SYMBOLS];

// Excludes visually ambiguous characters (0/O, 1/l/I) since a generated password is
// sometimes read off a screen rather than pasted. One character is guaranteed from each
// category, the rest filled from the combined pool, then Fisher-Yates shuffled so the
// guaranteed characters aren't always in the first four positions.
export function generatePassword(length = 20): string {
  const randomBytes = new Uint32Array(length);
  crypto.getRandomValues(randomBytes);

  const chars = CATEGORIES.map((pool, i) => pool[randomBytes[i] % pool.length]);
  for (let i = CATEGORIES.length; i < length; i++) {
    chars.push(ALL[randomBytes[i] % ALL.length]);
  }

  const shuffleBytes = new Uint32Array(chars.length);
  crypto.getRandomValues(shuffleBytes);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
}

const EMPTY_STRENGTH: PasswordStrength = { score: 0, label: '', color: 'rgba(255, 255, 255, 0.08)' };

// A rough entropy estimate (charset-size ^ length, in bits), discounted by how many of the
// characters are actually unique so a long repeated string doesn't score as strong as a
// genuinely random one of the same length. Good enough for a UI hint, not a real scorer.
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return EMPTY_STRENGTH;

  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;

  const rawBits = password.length * Math.log2(Math.max(poolSize, 2));
  const uniqueRatio = new Set(password).size / password.length;
  const bits = rawBits * Math.min(1, uniqueRatio + 0.4);

  if (bits < 28) return { score: 1, label: 'Weak', color: '#ff4d4f' };
  if (bits < 45) return { score: 2, label: 'Fair', color: '#faad14' };
  if (bits < 65) return { score: 3, label: 'Good', color: '#3b82f6' };
  return { score: 4, label: 'Strong', color: '#22c55e' };
}

interface PasswordInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  prefix?: ReactNode;
  autoFocus?: boolean;
  autoComplete?: string;
}

// Input.Password plus a one-click strong-password generator and a live strength meter.
// For fields where a *new* password is being chosen, not for confirming an existing one.
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  prefix,
  autoFocus,
  autoComplete,
}: PasswordInputProps) {
  const strength = passwordStrength(value ?? '');

  return (
    <div>
      <Space.Compact style={{ width: '100%' }}>
        <Input.Password
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          prefix={prefix}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
        />
        <Tooltip title="Generate a strong password">
          <Button icon={<SyncOutlined />} onClick={() => onChange?.(generatePassword())} />
        </Tooltip>
      </Space.Compact>
      {value && (
        <Space size={8} style={{ width: '100%', marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 3, width: 120 }}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: 4,
                  width: 27,
                  borderRadius: 2,
                  background: i < strength.score ? strength.color : 'rgba(255, 255, 255, 0.08)',
                  transition: 'background-color 0.3s ease',
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 11, color: strength.color }}>{strength.label}</span>
        </Space>
      )}
    </div>
  );
}
