import django

django.setup()

from datetime import timedelta  # noqa: E402

from django.contrib.auth.models import Group, Permission, User  # noqa: E402
from django.db import connection  # noqa: E402
from django.utils.timezone import now  # noqa: E402
from social_django.models import UserSocialAuth  # noqa: E402

from judge.models import Badge, Contest, Organization, Profile, WebAuthnCredential  # noqa: E402


def perm(name):
    return Permission.objects.get(content_type__app_label='judge', codename=name)


staff = Group.objects.create(name='Staff')
staff.permissions.add(perm('edit_all_problem'))
Group.objects.create(name='Org Admin').permissions.add(perm('edit_own_problem'))
gold = Badge.objects.create(name='Gold')


def user(username, email='', password=None, **kw):
    u = User.objects.create_user(username, email, password)
    for k, v in kw.items():
        setattr(u, k, v)
    u.save()
    return u


alice = user('alice', 'alice@example.com', 'alice-pass')
alice.groups.add(staff)
alice.user_permissions.add(perm('rejudge_submission'))
pa = Profile.objects.create(user=alice, is_totp_enabled=True, totp_key='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
                            scratch_codes='["ABCDEFGHIJKLMNOP"]')
org_a = Organization.objects.create(name='Org A', slug='org-a', short_name='A', about='')
org_b = Organization.objects.create(name='Org B', slug='org-b', short_name='B', about='')
pa.organizations.add(org_b)
pa.organizations.add(org_a)
pa.badges.add(gold)
WebAuthnCredential.objects.create(user=pa, name='key', cred_id='cred-1', public_key='pk', counter=3)

bob = user('bob', 'bob@example.com', 'bob-pass')
Profile.objects.create(user=bob)
UserSocialAuth.objects.create(user=bob, provider='google-oauth2', uid='g-123', extra_data={'email': 'bob@example.com'})
Profile.objects.create(user=user('robert', 'BOB@example.com', 'robert-pass'))
carol = user('carol', 'carol@example.com', 'carol-pass', is_active=False)
Profile.objects.create(user=carol, ban_reason='spam')
dave = user('dave', 'dave@example.com')
Profile.objects.create(user=dave)
user('noprofile', 'np@example.com', 'np-pass')
Contest.objects.create(key='c1', name='C1', start_time=now(), end_time=now() + timedelta(hours=1))

with connection.cursor() as c:
    c.execute("SET SESSION sql_mode = ''")
    c.execute("UPDATE judge_profile SET data_last_downloaded = '0000-00-00 00:00:00' WHERE user_id = %s", [carol.id])
    c.execute("UPDATE auth_user SET password = 'md5$salt$abc' WHERE id = %s", [dave.id])
    c.execute("UPDATE judge_contest SET format_config = '{bad' WHERE `key` = 'c1'")
