import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Tab {
  key: string;
  label: string;
  icon?: ReactNode;
  badge?: number | string;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  size?: 'sm' | 'md' | 'lg';
  stretched?: boolean;
  className?: string;
}

const HEIGHT = { sm: '32px', md: '40px', lg: '48px' };

export default function Tabs({ tabs, active, onChange, size = 'md', stretched, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn('monday-tab-list', stretched && 'w-full', className)}
      aria-label="tabs"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={tab.key === active}
          aria-disabled={tab.disabled}
          disabled={tab.disabled}
          onClick={() => !tab.disabled && onChange(tab.key)}
          className={cn('monday-tab', stretched && 'flex-1')}
          style={{ minHeight: HEIGHT[size] }}
        >
          <span className="monday-tab-inner">
            {tab.icon && <span style={{ color: 'var(--icon-color)', display: 'flex' }}>{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[11px] font-semibold rounded-full"
                style={{
                  background: tab.key === active ? 'var(--primary-color)' : 'var(--ui-background-color)',
                  color: tab.key === active ? 'var(--text-color-on-primary)' : 'var(--secondary-text-color)',
                }}
              >
                {tab.badge}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
