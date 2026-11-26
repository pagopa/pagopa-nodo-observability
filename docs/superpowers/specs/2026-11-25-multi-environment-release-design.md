# Multi-environment release workflow design

## Goal

Implement `.github/workflows/release_deploy_multi_env.yml` following the
multi-environment release/deploy pattern in
`pagopa/pagopa-node-technical-support-worker`, adapted to this Angular
frontend's existing AKS deployment workflow.

## Behavior

- `workflow_dispatch` inputs are `deploy_dev`, `deploy_uat`, and `deploy_prod`
  (booleans default false); `deploy_mode` (choice `parallel` or `sequential`,
  default `parallel`); `semver` (choice `skip`, `promote`, `patch`,
  `new_release`, or `breaking_change`, default `patch`); and `beta` (boolean,
  default false).
- Reusable workflow calls retain the existing required `environment` and
  `semver` inputs. A legacy environment of dev, uat, or prod selects that one
  environment; `all` selects all three. Other legacy environment values fail
  setup. Setup uses the non-empty `inputs.environment` value to distinguish a
  reusable call from a manual run and selects from the legacy environment;
  otherwise it reads the dispatch checkboxes. Reusable calls use parallel
  deployment; no new `workflow_call` inputs are introduced.
- Setup emits the normalized semver decision and a JSON array of selected
  environments, and rejects an empty selection, invalid legacy environment,
  or unsupported semver. It resolves semver from the selected environments
  rather than using `nodo5-semver-setup`, whose pinned implementation reads
  `github.event.inputs.environment` and defaults to dev when that field is
  absent. Dev-only selections retain the existing policy: `promote` and
  `skip` skip the release; on non-main refs the other accepted choices become
  `buildNumber`; on main, `patch`, `new_release`, and `breaking_change` map to
  `patch`, `minor`, and `major`. If uat or prod is selected, apply the
  stricter policy: reject main refs and `new_release`/`breaking_change`,
  allow `patch`, `promote`, or `skip`, and treat tag refs as `skip`.
  For dev-only selections on a tag ref, accept only `promote` or `skip` (both
  resolve to `skip`); reject version-bumping choices because the release action
  cannot safely push a release commit from a tag ref.
- A non-skipped semver operation creates one release for the run. With
  `semver=skip`, the existing `package.json` version is used. For a manual
  run, `beta` is passed to the release action; it has no effect when release
  is skipped. Reusable calls do not add a beta input and therefore use false.
- Each selected environment is preflighted and gets its own Docker image tagged
  `<version>-<environment>`. The image build receives that environment's
  API, Entra ID, and ingress base-href configuration, since those values are
  compiled into the Angular bundle.
- Parallel mode deploys selected environments independently. Sequential mode
  deploys in dev → uat → prod order, allowing an unselected earlier environment
  to be skipped without blocking later selected environments.
- Deployments use the existing `aks-deploy` action, GitHub environment
  protection, and environment-specific cluster settings.

## Workflow structure

Keep the change within the target workflow. Setup emits `semver` and
`package_version` outputs as strings and `environments` as a JSON-encoded
string array of unique values (`dev`, `uat`, `prod`). It checks out the
immutable `github.sha` and reads `package_version` from `package.json` for
fallback use. A selection-dependent semver shell step validates inputs and
uses the environment/ref rules above to emit the release action's accepted
values: `major`, `minor`, `patch`, `buildNumber`, or `skip`.
A preflight matrix runs once per selected GitHub environment before the release. It verifies
`helm/Chart.yaml`, `helm/values-<environment>.yaml`, absence of unresolved
`<TO_BE_DEFINED_...>` placeholders in those two files, and the environment
variables `NAMESPACE`, `CLUSTER_NAME`, and `CLUSTER_RESOURCE_GROUP`. It also
validates the HAProxy ingress path at
`.microservice-chart.ingress.haproxy.path` in the selected environment's values
file against `^/[A-Za-z0-9._/-]*$`.

The release job runs once after all preflights succeed, unless semver is
`skip`; it exposes `steps.release.outputs.version`. The pinned release action
checks out the workflow event commit, bumps the package and Helm chart, pushes
the release commit, and creates a tag. A skipped release exposes no version,
so image and deploy jobs use
`${{ needs.release.outputs.version || needs.setup.outputs.package_version }`.
An image matrix then runs once per selected environment and tags each image
`<version>-<environment>`. For a new release, it checks out the immutable
release tag; for `semver=skip`, it checks out the original `github.sha`. It
reads the ingress path again to derive `BASE_HREF`, and supplies that environment's
`API_BASE_URL`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_SCOPES`, and
`BASE_HREF` build arguments. The preflight and image matrix jobs declare the
selected GitHub environment so its vars and secrets are available, following
the existing single-environment workflow's pattern. Preflight requires
non-empty `NAMESPACE`, `CLUSTER_NAME`, `CLUSTER_RESOURCE_GROUP`,
`API_BASE_URL`, `ENTRA_TENANT_ID`, and `ENTRA_CLIENT_ID`; `ENTRA_SCOPES` may
be empty. `API_BASE_URL`, `ENTRA_CLIENT_ID`, and `ENTRA_SCOPES` come from
environment `vars`; `ENTRA_TENANT_ID` comes from environment `secrets`.
`NAMESPACE`, `CLUSTER_NAME`, `CLUSTER_RESOURCE_GROUP`, and `WORKLOAD_IDENTITY_ID`
come from environment `vars`; `CD_CLIENT_ID` and `SUBSCRIPTION_ID` come from
environment `secrets`. The deployment config generator remains the source of
format validation for frontend settings during image build. Each preflight,
image, and deploy job declares the GitHub environment; environment protection
approvals therefore apply at each of those gates, as in the existing
single-environment workflow.

Deploy jobs use the same release-tag/original-SHA selection for Helm files,
avoiding branch-tip drift after approvals. The pinned `node-release` action's
beta Helm bump enables `canaryDelivery.create` in all environment values and
sets a shared canary tag to the release version, while the image build uses
environment-specific tags. For a beta release, deployment must preserve the
stable image tag and override
`microservice-chart.canaryDelivery.image.tag` with
`<version>-<environment>`. For a non-beta deployment, set the stable image
tag to that environment's image tag. Always overriding the canary image tag to
the per-environment tag also keeps later deployments of an environment
consistent after a beta release; the Helm `create` flag remains controlled by
the release bump.

The base href is the ingress path with trailing slashes removed, followed by
one slash; a root path therefore resolves to `/`. An empty or invalid path
fails preflight. Deployment jobs use the same selected-environment JSON and
the same effective-version fallback: a matrix for parallel mode and ordered
dev/uat/prod jobs for sequential mode.

Sequential `deploy_dev` depends on setup, preflight, release, and image;
`deploy_uat` additionally depends on `deploy_dev`; `deploy_prod` additionally
depends on both `deploy_dev` and `deploy_uat`. A selected environment proceeds
only when every preceding environment job succeeded or was skipped because it
was not selected. A failed preceding deployment blocks later deployments.
Parallel deployments use a matrix over `environments` and depend on setup,
preflight, release, and image. Release and image outcomes gate all
deployments; each condition uses `always()` to override the implicit
`success()` behavior, then explicitly requires setup/preflight/image success,
release success or release skipped only for `semver=skip`, and no cancellation.
Sequential jobs additionally require each selected predecessor to succeed and
allow a predecessor to be skipped only when that environment is unselected.
Thus `skip` bypasses release but not image build or deployment. The deployment jobs use
`aks-deploy@5e788a4717069100914e66149997ecfd4c48b746`, with the existing
branch, client/subscription/tenant IDs, namespace, cluster, resource group,
application name, and workload identity Helm settings.

No automatic rollback or release deletion is attempted after a release,
image-build, or deployment failure; the failure is surfaced by the run, and
recovery uses a new manual run with the appropriate existing semver mode.
No concurrency group is added, so concurrent runs retain GitHub Actions'
default behavior.

Do not add a shared cross-environment image, new deployment abstractions, or
Slack notifications as part of this change.

## Failure handling and validation

Fail setup when no environment is selected, a legacy environment or semver is
invalid, a uat/prod selection targets `main`, or a uat/prod selection requests
`new_release`/`breaking_change`. A dev-only tag ref must reject
`patch`/`new_release`/`breaking_change`.
Fail preflight before release when the chart or environment values file is
missing, a placeholder remains, a required environment variable is empty, or
the ingress path fails the specified pattern or is empty. A failed release or
any image build must prevent deployment; a failed deployment must not allow a
later selected environment to deploy in sequential mode. Unselected
environments must neither be preflighted nor deployed.

Add a dedicated multi-environment workflow test to `npm run
test:deployment-config`. It covers selection script behavior and statically
checks the release, image matrix, and deployment dependency/condition
contracts, the selection-based semver normalization and ref rules, immutable
source checkouts, and beta stable/canary Helm overrides. Validate with
`npm run test:deployment-config` and
`npx prettier --check .github/workflows/release_deploy_multi_env.yml` for YAML
parsing/formatting. Confirm the final diff does not alter `release_deploy.yml`
or unrelated worktree files. Acceptance cases include empty manual selection,
invalid legacy environment, one and several selected environments,
`environment=all`, invalid semver, uat/prod restrictions on main/tags,
dev tag bump rejection, `semver=skip`, failed preflight/release/image, beta and
stable deployments, parallel deployment, and sequential deployment with
unselected or failed predecessors.
