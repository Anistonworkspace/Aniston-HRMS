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
      className={cn(
        'inline-flex items-center h-8 rounded-full border border-gray-200 bg-gray-50 text-[11px] font-semibold overflow-hidden select-none',
        className
      )}
    >
      <span className={cn(
        'px-2.5 py-1 transition-colors rounded-l-full',
        !isHindi ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700'
      )}>
        EN
      </span>
      <span className="text-gray-300 text-xs">|</span>
      <span className={cn(
        'px-2.5 py-1 transition-colors rounded-r-full',
        isHindi ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-700'
      )}>
        हि
      </span>
    </button>
  );
}
