import hmac
import json

import django

django.setup()

import pyotp  # noqa: E402
from django.conf import settings  # noqa: E402
from django.contrib.auth.hashers import PBKDF2PasswordHasher, PBKDF2SHA1PasswordHasher, make_password  # noqa: E402
from fernet_fields import EncryptedCharField  # noqa: E402

KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
fernet = EncryptedCharField().fernet
out = {
    'secretKey': settings.SECRET_KEY,
    'passwords': [
        {'password': 'correct horse', 'hash': make_password('correct horse')},
        {'password': 'Mật khẩu ✓', 'hash': PBKDF2PasswordHasher().encode('Mật khẩu ✓', 'salt1234salt', iterations=260000)},
        {'password': 'legacy', 'hash': PBKDF2SHA1PasswordHasher().encode('legacy', 'saltsalt', iterations=30000)},
    ],
    'fernet': [{'plain': p, 'cipher': fernet.encrypt(p.encode()).decode()} for p in [KEY, '["ABCDEFGHIJKLMNOP"]']],
    'webauthnHandles': [
        {'profileId': i, 'handle': hmac.new(settings.SECRET_KEY.encode(), b'webauthn:%d' % i, 'sha256').hexdigest()}
        for i in (1, 42, 123456)
    ],
    'totp': [{'key': KEY, 'timecode': t, 'code': pyotp.TOTP(KEY).generate_otp(t)} for t in (0, 1, 59000000)],
}
with open('/out/django.json', 'w') as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
