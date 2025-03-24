# Change Log

## [0.2.3] - 2025-24-03
- Fallback to kubectl get if ressource is not available via edactl
- Added delete resource functionality
- Restart of deployments is now possible

## [0.2.0] - 2025-16-03
- No more polling, Following the EDA first principles of ⛔ polling the extension is now using watchers to fetch the available state almost in realtime. This eliminates the need to ever hit refresh, as the extension will be notified of the resource changes as they come.

## [0.1.0] - 2025-09-03
- Initial public release