.PHONY: bootstrap-host cleanup-orphan-avatars

bootstrap-host:
	@if [ -z "$$ADMIN_TOKEN" ] || [ -z "$$ROOM_ID" ] || [ -z "$$HOST_IDENTITY" ]; then \
		echo "usage: ADMIN_TOKEN=... ROOM_ID=test HOST_IDENTITY=alice_host make bootstrap-host"; \
		exit 2; \
	fi
	@./scripts/bootstrap-host.sh

cleanup-orphan-avatars:
	@./scripts/cleanup-orphan-avatars.sh
