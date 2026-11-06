// Jest stand-in for react-markdown and remark-gfm, which ship only as ESM.
// Renders the raw markdown as text; no test checks markdown formatting.
import React from 'react';

export default function Markdown({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
