export const githubCredentialHelper = `#!/bin/sh
[ "$1" = get ] || exit 0
protocol= host= path=
while IFS= read -r line && [ -n "$line" ]; do
  case "$line" in
    protocol=*) protocol=\${line#protocol=} ;;
    host=*) host=\${line#host=} ;;
    path=*) path=\${line#path=} ;;
  esac
done
[ "$protocol" = https ] && [ "$host" = github.com ] || exit 1
[ "$path" = "$LOOM_GITHUB_REPOSITORY" ] || [ "$path" = "$LOOM_GITHUB_REPOSITORY.git" ] || exit 1
printf 'username=x-access-token\\npassword=%s\\n\\n' "$LOOM_GITHUB_TOKEN"
`;
