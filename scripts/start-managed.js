import { config } from 'dotenv'
import { prepareManagedEnvironment } from './configure-managed.js'

config()
prepareManagedEnvironment(process.env)
await import('../src/app/app.js')
