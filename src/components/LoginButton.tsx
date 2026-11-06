import React from 'react';
import { useAnalytics } from '../contexts/AnalyticsContext';

/**
 * LoginButton Component
 *
 * A standalone component for the login button that can be styled independently
 *
 * @param props - Component props
 * @param props.loginUrl - URL to navigate to for login
 * @param props.className - Optional CSS class for styling
 * @param props.style - Optional inline styles
 * @param props.isHeaderButton - Whether this is rendered in the header (different styling)
 * @returns Rendered login button
 */
interface LoginButtonProps {
  loginUrl: string;
  className?: string;
  style?: React.CSSProperties;
  isHeaderButton?: boolean;
  /** Replaces following the link, e.g. to sign in through a popup. */
  onClick?: () => void;
}

const LoginButton: React.FC<LoginButtonProps> = ({
  loginUrl,
  className = '',
  style,
  isHeaderButton = false,
  onClick
}) => {
  const { trackEvent } = useAnalytics();

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    trackEvent({ type: 'chatbot_login_clicked', loginUrl });
    if (onClick) {
      event.preventDefault();
      onClick();
    }
  };
  const headerStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '6px 12px',
    backgroundColor: 'transparent',
    border: '1px solid #ccc',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '4px',
    fontWeight: 'normal',
    textAlign: 'center',
    margin: '8px',
    fontSize: '12px',
    opacity: 0.8,
    transition: 'all 0.2s ease'
  };

  const defaultStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '10px 20px',
    backgroundColor: 'white',
    border: '1px solid var(--primaryColor, #107180)',
    color: 'var(--primaryColor, #107180)',
    textDecoration: 'none',
    borderRadius: '4px',
    fontWeight: 'bold',
    textAlign: 'center',
    margin: '18px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
  };

  const finalStyle = isHeaderButton ? headerStyle : defaultStyle;

  return (
    <>
      {isHeaderButton && (
        <style>
          {`
            .rcb-chat-header-container .qa-bot-header-login-button:hover {
              background-color: #0000001a !important;
              opacity: 1 !important;
            }
          `}
        </style>
      )}
      <a
        href={loginUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`qa-bot-login-button ${isHeaderButton ? 'qa-bot-header-login-button' : ''} ${className}`}
        style={{ ...finalStyle, ...style }}
        onClick={handleClick}
      >
        Log In
      </a>
    </>
  );
};

export default LoginButton;
