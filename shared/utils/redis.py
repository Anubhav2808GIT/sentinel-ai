import redis.asyncio as redis
from shared.config.settings import settings

def get_redis_client() -> redis.Redis:
    return redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        decode_responses=True
    )
