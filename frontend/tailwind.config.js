/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Monday.com primary UI font (body, controls)
        body: ['Figtree', 'DM Sans', 'Roboto', 'sans-serif'],
        // Monday.com title font (headings)
        display: ['Poppins', 'Sora', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Monday.com brand blue replaces old indigo brand
        brand: {
          50: '#f0f7ff',   // --primary-highlighted-color
          100: '#cce5ff',  // --primary-selected-color
          200: '#aed4fc',  // --primary-selected-hover-color
          300: '#579bfc',  // bright-blue
          400: '#1f76c2',  // --link-color
          500: '#0073ea',  // --primary-color
          600: '#0073ea',  // --primary-color (main)
          700: '#0060b9',  // --primary-hover-color
          800: '#004e99',
          900: '#003d80',
          950: '#001f40',
        },
        surface: {
          0: '#ffffff',    // --primary-background-color
          1: '#f6f7fb',    // --grey-background-color
          2: '#f6f7fb',    // --allgrey-background-color
          3: '#e7e9ef',    // --ui-background-color
          dark: {
            0: '#181b34',  // --primary-background-color dark
            1: '#30324e',  // --secondary-background-color dark
            2: '#3c3f59',  // --disabled-background-color dark
            3: '#4b4e69',  // --layout-border-color dark
          },
        },
        // Monday.com semantic color aliases
        monday: {
          primary: '#0073ea',
          'primary-hover': '#0060b9',
          'primary-selected': '#cce5ff',
          positive: '#00854d',
          negative: '#d83a52',
          warning: '#ffcb00',
          border: '#d0d4e4',
          'ui-border': '#c3c6d4',
          text: '#323338',
          'text-secondary': '#676879',
          bg: '#f6f7fb',
        },
      },
      gridTemplateColumns: {
        '13': 'repeat(13, minmax(0, 1fr))',
      },
      borderRadius: {
        // Monday.com border radius tokens
        sm: '4px',   // --border-radius-small (buttons, inputs, chips)
        md: '8px',   // --border-radius-medium (cards, popovers)
        lg: '8px',   // keep lg same as md for consistency
        xl: '16px',  // --border-radius-big (modals)
        '2xl': '16px',
      },
      boxShadow: {
        // Monday.com elevation system
        'monday-xs': '0px 4px 6px -4px rgba(0, 0, 0, 0.1)',
        'monday-sm': '0px 4px 8px rgba(0, 0, 0, 0.2)',
        'monday-md': '0px 6px 20px rgba(0, 0, 0, 0.2)',
        'monday-lg': '0px 15px 50px rgba(0, 0, 0, 0.3)',
        // Legacy aliases (keep for backward compat)
        glass: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
        'glass-lg': '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
        layer: '0px 4px 6px -4px rgba(0, 0, 0, 0.1)',
        'layer-md': '0px 4px 8px rgba(0, 0, 0, 0.2)',
        'layer-lg': '0px 6px 20px rgba(0, 0, 0, 0.2)',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s cubic-bezier(0, 0, 0.35, 1)',
        'slide-up': 'slideUp 0.25s cubic-bezier(0, 0, 0.35, 1)',
        'slide-down': 'slideDown 0.25s cubic-bezier(0, 0, 0.35, 1)',
        'scale-in': 'scaleIn 0.15s cubic-bezier(0, 0, 0.35, 1)',
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.8)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
