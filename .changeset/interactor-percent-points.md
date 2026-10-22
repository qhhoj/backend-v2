---
'qhhoj-backend': patch
---

Polygon interactive problems with "treat points from checker as percent" read the interactor's points as a percentage (`interactive.treat_checker_points_as_percentage`, routed only to judges that advertise feature `interactive.percentage`); an import with rescaled fractional points is refused for an interactor without the flag.
