from fastapi import APIRouter, Depends, HTTPException, status
from models.schemas import LoginRequest, LoginResponse
from services.auth_service import authenticate_user, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Admin girişi — JWT token döner."""
    if not authenticate_user(request.username, request.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kullanıcı adı veya şifre hatalı",
        )
    token = create_access_token({"sub": request.username})
    return LoginResponse(access_token=token)


@router.get("/me")
async def me(username: str = Depends(get_current_user)):
    """Oturum kontrolü."""
    return {"username": username, "authenticated": True}


@router.post("/logout")
async def logout():
    """Client tarafında token silineceği için sunucu tarafında işlem yok."""
    return {"message": "Çıkış yapıldı"}
