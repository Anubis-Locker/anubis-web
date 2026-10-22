import { loginText } from './login-i18n'
import { logoPath2 } from '../electerm-react/common/constants'
import { brand } from '../../app/common/brand.config.js'
import './login-footer.styl'

// Footer of the pre-login screens. All links come from brand.config.js
// (src/app/common/brand.config.js); edit them there.

const { urls } = brand

const columns = (t) => [
  {
    title: t.product,
    links: [
      { label: t.about, href: urls.about },
      { label: t.dl, href: urls.download },
      { label: t.online, href: urls.cloud },
      { label: t.videoGuides, href: urls.videos },
      { label: t.blog, href: urls.blog },
      { label: t.documentation, href: urls.docs },
      { label: t.sponsor, href: urls.sponsor }
    ]
  },
  {
    title: t.community,
    links: [
      { label: 'GitHub', href: urls.git.org },
      { label: t.discussions, href: urls.git.discussions },
      { label: t.reportIssues, href: urls.git.issues },
      { label: t.translations, href: urls.git.locales }
    ]
  },
  {
    title: t.related,
    links: [
      { label: brand.name + ' sync', href: urls.sync },
      { label: brand.name + ' web', href: urls.git.repo },
      { label: brand.name + ' theme', href: urls.theme },
      { label: 'manate', href: 'https://github.com/tylerlong/manate' }
    ]
  }
]

const bottomLinks = (t) => [
  { label: t.about, href: urls.about },
  { label: t.contact, href: urls.contact },
  { label: t.faq, href: urls.faq },
  { label: t.terms, href: urls.terms },
  { label: t.privacyPolicy, href: urls.privacy }
]

const renderLinks = (links) => (
  <ul>
    {links.map(l => (
      <li key={l.href}>
        <a href={l.href} target='_blank' rel='noreferrer noopener'>{l.label}</a>
      </li>
    ))}
  </ul>
)

export default function LoginFooter (props) {
  const t = loginText(props.lang)

  return (
    <footer className='site-footer'>
      <div className='site-footer-inner'>
        <div className='footer-grid'>
          <div className='footer-brand'>
            <div className='footer-brand-name'>{brand.name}</div>
            <p>{t.brandDesc}</p>
          </div>
          {columns(t).map(col => (
            <div className='footer-col' key={col.title}>
              <h4>{col.title}</h4>
              {renderLinks(col.links)}
            </div>
          ))}
        </div>
        <div className='footer-bottom'>
          <p>{brand.copyright}</p>
          <div className='footer-bottom-links'>
            {bottomLinks(t).map(l => (
              <a key={l.href} href={l.href} target='_blank' rel='noreferrer noopener'>{l.label}</a>
            ))}
          </div>
        </div>
        {/* last, in flow: the upstream site parks this in the space it reserves
            below the bottom bar, so it never lands behind the links */}
        <div
          className='site-footer-watermark'
          style={{
            backgroundImage: `url("${logoPath2}")`
          }}
        />
      </div>
    </footer>
  )
}
