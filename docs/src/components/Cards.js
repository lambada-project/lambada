import React from 'react'
import Link from '@docusaurus/Link'

export function Cards({ children }) {
  return <div className="lb-cards">{children}</div>
}

export function Card({ to, title, children }) {
  return (
    <Link className="lb-card" to={to}>
      <div className="lb-card__title">{title}</div>
      <div className="lb-card__body">{children}</div>
    </Link>
  )
}
