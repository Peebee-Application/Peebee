# Restaurant theme follows customer display mode

This supersedes the mode-precedence evidence in PR #43. The Food owner chooses the colour scene; the customer app selects that scene's light/dark variant using its own resolved appearance mode. Owner theme_mode remains the Food app's preference and no longer controls the customer storefront or dish pages. The common Peebee header/navigation remain outside the business colour scope.

Mobile verification used a fictional business and the Marple palette at 390 x 844:

- Owner mode light, customer dark: business data-theme dark, scene marple, background rgb(30,20,23). [Dark screenshot](customer-marple-dark.png).
- Owner mode dark, customer light: business data-theme light, scene marple, background rgb(253,245,241). [Light screenshot](customer-marple-light.png).

The same wrapper applies mode selection to every supported scene and to full dish pages. No owner preferences or production data were changed. Temporary API fixtures were removed before commit. The existing root-mode observer keeps the restaurant variant in step with the customer mode. No migration or backend changes.
