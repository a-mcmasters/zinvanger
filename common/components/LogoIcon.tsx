import type { SvgIconProps } from '@mui/material/SvgIcon';
import SvgIcon from '@mui/material/SvgIcon';
import { brandGradient } from '@project/common/theme';

const LogoIcon = ({ style, ...rest }: SvgIconProps) => {
    return (
        <SvgIcon viewBox="0 0 128 128" style={{ background: brandGradient, borderRadius: '23%', ...style }} {...rest}>
            <path
                d="M92 52V40a12 12 0 0 0-12-12H34a12 12 0 0 0-12 12v26a12 12 0 0 0 12 12h10"
                fill="none"
                stroke="#ddc4ff"
                strokeWidth="10"
            />
            <path d="m44 40 16 9c3 2 3 4 0 6l-16 9c-3 1-5 0-5-3V43c0-3 2-4 5-3Z" fill="#ddc4ff" />
            <rect x="51" y="60" width="62" height="48" rx="12" fill="#f2e3ff" />
            <path
                d="M66 72h32a5 5 0 0 1 0 10H66a5 5 0 0 1 0-10Zm0 14h20a5 5 0 0 1 0 10H66a5 5 0 0 1 0-10Z"
                fill="#52248d"
            />
        </SvgIcon>
    );
};

export default LogoIcon;
