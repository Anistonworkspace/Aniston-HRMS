import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

interface LanguageSwitcherProps {
  className?: string;
}

export default function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const isHindi = i18n.language === 'hi';

  const toggle = () => {
    i18n.changeLanguage(isHindi ? 'en' : 'hi');
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle language"
      className={cn('inline-flex items-center h-8 text-[11px] font-semibold overflow-hidden select-none', className)}
      style={{
        borderRadius: '50px',
        border: '1px solid var(--ui-border-color)',
        background: 'var(--allgrey-background-color)',
      }}
    >
      <span
        className="px-2.5 py-1 transition-colors"
        style={{
          borderRadius: '50px 0 0 50px',
          background: !isHindi ? 'var(--primary-color)' : 'transparent',
          color: !isHindi ? 'var(--text-color-on-primary)' : 'var(--secondary-text-color)',
        }}
      >
        EN
      </span>
      <span style={{ color: 'var(--ui-border-color)', fontSize: '12px' }}>|</span>
      <span
        className="px-2.5 py-1 transition-colors"
        style={{
          borderRadius: '0 50px 50px 0',
          background: isHindi ? 'var(--primary-color)' : 'transparent',
          color: isHindi ? 'var(--text-color-on-primary)' : 'var(--secondary-text-color)',
        }}
      >
        हि
      </span>
    </button>
  );
}
