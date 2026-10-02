import os

import dmoj.compressor_patch  # noqa: F401  (django-compressor vs Django 5.1; manage.py does this, our scripts do not)

from dmoj.settings import *  # noqa: F401,F403

SECRET_KEY = 'qhhoj-test-secret'
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.mysql', 'NAME': 'legacy', 'USER': 'root', 'PASSWORD': 'root',
    'HOST': os.environ.get('DB_HOST', 'mariadb'), 'OPTIONS': {'charset': 'utf8mb4'},
}}
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
STATIC_ROOT = '/tmp/static'
