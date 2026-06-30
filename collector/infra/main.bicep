// Audit collector infrastructure for Fabric Capacity Manager.
//
// Provisions a keyless, identity-based stack:
//   - Storage account (shared-key access disabled) for the Functions host and
//     the durable audit table.
//   - Log Analytics + Application Insights for structured audit traces.
//   - A Flex Consumption Function App with a system-assigned managed identity.
//   - Least-privilege role assignments so the identity can use storage without
//     any access keys or connection strings.
//
// Security choices:
//   - allowSharedKeyAccess: false  -> no storage keys exist to leak.
//   - Managed identity + RBAC      -> data-plane access is auditable and scoped.
//   - httpsOnly + TLS 1.2 minimum  -> transport security.

@description('Location for all resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Short base name used to derive resource names.')
@minLength(3)
@maxLength(12)
param baseName string = 'fcmaudit'

@description('Entra tenant GUID used to validate audit-event bearer tokens.')
param entraTenantId string = subscription().tenantId

@description('Expected audience of the audit-event bearer token (the collector app id URI).')
param audience string

@description('SPA origins allowed to call the collector (CORS).')
param allowedOrigins string[]

@description('Name of the table that stores audit events.')
param auditTableName string = 'AuditEvents'

var suffix = uniqueString(resourceGroup().id)
var storageAccountName = toLower('st${suffix}')
var functionAppName = '${baseName}-func-${suffix}'
var planName = '${baseName}-plan-${suffix}'
var deploymentContainerName = 'deploymentpackage'

// Built-in role definition ids (data-plane, least privilege).
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: storage
  name: 'default'
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: deploymentContainerName
}

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${baseName}-logs-${suffix}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-ai-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logWorkspace.id
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '20'
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      cors: {
        allowedOrigins: allowedOrigins
      }
      appSettings: [
        // Identity-based host storage (no keys).
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storage.name
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'AUDIT_TENANT_ID'
          value: entraTenantId
        }
        {
          name: 'AUDIT_AUDIENCE'
          value: audience
        }
        // Keyless table access; the code uses DefaultAzureCredential.
        {
          name: 'AUDIT_TABLE_ACCOUNT_URL'
          value: storage.properties.primaryEndpoints.table
        }
        {
          name: 'AUDIT_TABLE_NAME'
          value: auditTableName
        }
      ]
    }
  }
}

// The host needs blob access for deployment + leases; Owner covers container
// management on the deployment container.
resource blobOwnerAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, functionApp.id, storageBlobDataOwnerRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// The collector writes audit events to the table.
resource tableContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, functionApp.id, storageTableDataContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

@description('Function App name (for func azure functionapp publish).')
output functionAppName string = functionApp.name

@description('Audit collector endpoint to set as VITE_AUDIT_REMOTE_URL.')
output auditEndpoint string = 'https://${functionApp.properties.defaultHostName}/api/audit'

@description('Application Insights resource name.')
output appInsightsName string = appInsights.name

@description('Storage account backing the host and the audit table.')
output storageAccountName string = storage.name
