---
name: publish-site
description: Publish NOVAPA website changes — commit every change and push to the GitHub repo (anthonycmn/novapawebsite), which triggers an automatic Netlify deploy to https://www.northernvirginiaperformingarts.org. Use whenever the user has edited the site and wants it live (e.g. "publish", "push my changes live", "update the website", "deploy").
---

# Publish the NOVAPA website

This project is a static HTML site. GitHub is connected to Netlify for
continuous deployment, so **pushing to GitHub `main` automatically deploys
to the live site**. This skill's whole job is: commit the local changes and
push them, then confirm the deploy is happening.

Working directory: `C:\Users\Tony\Desktop\NOVAPA WEB 7-16`
GitHub remote: `https://github.com/anthonycmn/novapawebsite` (branch `main`)
Live site: https://www.northernvirginiaperformingarts.org
Netlify project: `northernvirginiaperformingarts`

## Steps

1. **Check what changed.** Run `git status --short` and `git --no-pager diff --stat`.
   - If there is nothing to commit, tell the user the site is already up to date and stop.
   - Briefly list which files changed so the user sees what is going out.

2. **Stage everything.** Run `git add -A`.

3. **Commit.** Write a short, plain-English commit message describing the change.
   - If the user gave a message as an argument to the skill, use that.
   - Otherwise summarize the change from the diff (e.g. "Update summer camp dates on camp-info page"). Keep it to one line.
   - Append the co-author trailer on its own line after a blank line:
     `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

4. **Push.** Run `git push origin main`.
   - Credentials are cached via Git Credential Manager, so this should not prompt. If it does time out waiting on a sign-in window, run the push in the background and tell the user to complete the GitHub sign-in dialog on screen.

5. **Confirm the deploy.** After a successful push:
   - Tell the user the change is pushed to GitHub and Netlify is now building.
   - Netlify usually finishes a static deploy in under a minute. If asked to verify, check deploy status with the Netlify integration:
     use the Netlify project reader `get-project` with siteId `f709088b-fded-4e4f-9790-228d3cc46b55` and report whether `currentDeploy.state` is `ready`.
   - Give the user the live URL (https://www.northernvirginiaperformingarts.org) and the Netlify dashboard link (https://app.netlify.com/projects/northernvirginiaperformingarts) so they can watch the build if they want.

## Notes
- Never force-push and never rewrite history on `main` — this is a live production site.
- Large media files are fine (GitHub's per-file limit is 100 MB); if a file exceeds that, warn the user instead of committing it.
- This skill only publishes. It does not edit site content — make the edits first, then run it.
