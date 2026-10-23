import { useRef } from 'react'
import { logoPath2 } from '../electerm-react/common/constants'
import './login-logo.styl'

/**
 * The login page brand block: the Anubis-Security-Tool wordmark image.
 *
 * The animated three.js wordmark (login-logo-3d.js + electerm.glb) was baked
 * from the upstream electerm 3D model and cannot be re-rendered with our own
 * brand text without a new 3D asset, so it stays disabled here in favor of
 * the static logo image (already re-branded, see @brand-res/res/imgs).
 */
export default function LoginLogo () {
  const wrapRef = useRef(null)

  return (
    <div className='login-logo' ref={wrapRef}>
      <img
        className='login-logo-img'
        src={logoPath2}
        alt='Anubis-Security-Tool'
      />
    </div>
  )
}
