// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: maps Azure/Fabric regions to their geography so the
// workspace-move slices can distinguish same-geography moves from cross-region
// moves. Unknown regions fall back to matching only themselves.

function normalize(region: string): string {
  return region.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const regionToGeography: Record<string, string> = {
  // United States
  eastus: "United States",
  eastus2: "United States",
  centralus: "United States",
  northcentralus: "United States",
  southcentralus: "United States",
  westcentralus: "United States",
  westus: "United States",
  westus2: "United States",
  westus3: "United States",
  // Canada
  canadacentral: "Canada",
  canadaeast: "Canada",
  // Europe
  northeurope: "Europe",
  westeurope: "Europe",
  // United Kingdom
  uksouth: "United Kingdom",
  ukwest: "United Kingdom",
  // France
  francecentral: "France",
  francesouth: "France",
  // Germany
  germanywestcentral: "Germany",
  germanynorth: "Germany",
  // Switzerland
  switzerlandnorth: "Switzerland",
  switzerlandwest: "Switzerland",
  // Norway
  norwayeast: "Norway",
  norwaywest: "Norway",
  // Sweden
  swedencentral: "Sweden",
  swedensouth: "Sweden",
  // Asia Pacific
  eastasia: "Asia Pacific",
  southeastasia: "Asia Pacific",
  // Australia
  australiaeast: "Australia",
  australiasoutheast: "Australia",
  australiacentral: "Australia",
  australiacentral2: "Australia",
  // Japan
  japaneast: "Japan",
  japanwest: "Japan",
  // Korea
  koreacentral: "Korea",
  koreasouth: "Korea",
  // India
  centralindia: "India",
  southindia: "India",
  westindia: "India",
  // Brazil
  brazilsouth: "Brazil",
  brazilsoutheast: "Brazil",
  // UAE
  uaenorth: "United Arab Emirates",
  uaecentral: "United Arab Emirates",
  // South Africa
  southafricanorth: "South Africa",
  southafricawest: "South Africa",
};

/** Returns the geography a region belongs to, or the region itself if unknown. */
export function geographyOf(region: string): string {
  return regionToGeography[normalize(region)] ?? region;
}

/** True when both regions belong to the same geography. */
export function sameGeography(a: string, b: string): boolean {
  return geographyOf(a) === geographyOf(b);
}
