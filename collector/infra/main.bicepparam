using './main.bicep'

// Audience the collector expects in incoming bearer tokens. Set this to the
// audit collector app registration's Application ID URI, e.g. 'api://<app-id>'.
param audience = 'api://<collector-app-registration-id>'

// SPA origins permitted to call the collector. Add your deployed app origin.
param allowedOrigins = [
  'http://localhost:5173'
]

// entraTenantId defaults to the deployment subscription's tenant; override here
// if the collector validates tokens from a different tenant.
// param entraTenantId = '<entra-tenant-guid>'
