# Current developer roster for read-only IAM console/CLI access (SCRUM-372).
#
# Sourced from the GitHub repository's collaborator list
# (https://github.com/zctiong-iss/crewsafe), lowercased to satisfy the project's IAM
# username slug convention (variables.tf's validation block). Usernames are not secret —
# this file is deliberately committed and reviewed like any other change (research.md R-003).
#
# To onboard: add one entry, open a PR. To offboard: remove one entry, open a PR. See
# docs/runbooks/SCRUM-372-developer-readonly-iam-users.md §5-6.

developers = [
  { username = "animaexmachina" },  # GitHub: AnimaExMachina
  { username = "justinchua97" },    # GitHub: JustinChua97
  { username = "bryanpwy" },        # GitHub: bryanpwy
  { username = "kumaragurusurya" }, # GitHub: KumaraguruSurya
  { username = "jemilin-code" },    # GitHub: Jemilin-code
  { username = "zctiong-iss" },     # GitHub: zctiong-iss
  { username = "abn-13" },          # GitHub: abn-13
]
