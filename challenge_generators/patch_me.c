#include <stdio.h>
#include <string.h>

int main() {
    char input[50];
    printf("Token: ");
    scanf("%49s", input);
    if (strcmp(input, "SUPER_SECRET_999") != 0) printf("Denied.\n");
    else printf("tcs{jump_instruction_patched}\n");
    return 0;
}
